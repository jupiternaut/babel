"""Validate the specification package, never the unimplemented application.

Standard library structural checks plus optional, already installed jsonschema.
No network, installations, user data access, or application writes are performed.
Only validation-report.json next to this file is written.
"""
from __future__ import annotations

import copy
import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
CHECKS: list[dict] = []


def check(name, condition, detail=''):
    CHECKS.append({'name': name, 'passed': bool(condition), 'detail': detail})


def read_json(path):
    return json.loads((ROOT / path).read_text(encoding='utf-8-sig'))


def walk(value):
    if isinstance(value, dict):
        yield value
        for child in value.values():
            yield from walk(child)
    elif isinstance(value, list):
        for child in value:
            yield from walk(child)


def resolve(document, reference):
    if not reference.startswith('#/'):
        raise ValueError('Non-local contract reference: ' + reference)
    value = document
    for key in reference[2:].split('/'):
        key = key.replace('~1', '/').replace('~0', '~')
        value = value[int(key)] if isinstance(value, list) else value[key]
    return value


api = read_json('contracts/openapi.json')
events = read_json('contracts/events.schema.json')
task_doc = read_json('tasks.json')
tasks = task_doc['tasks']
schemas = api['components']['schemas']
check('OpenAPI version', api['openapi'] == '3.1.0')
check('Design-only status', task_doc['status'] == 'specification_only')
for label, doc in [('api', api), ('events', events)]:
    refs = [n['$ref'] for n in walk(doc) if '$ref' in n]
    errors = []
    for reference in refs:
        try:
            resolve(doc, reference)
        except (KeyError, ValueError, IndexError) as exc:
            errors.append(str(exc))
    check(label + ' local references', not errors, f'{len(refs)} references; {errors}')

operations = []
for path, item in api['paths'].items():
    for method, op in item.items():
        if method not in {'get','post','put','patch','delete','head','options','trace'}:
            continue
        operations.append(op['operationId'])
        parameters = item.get('parameters', []) + op.get('parameters', [])
        expected = set(re.findall(r'\{([^}]+)\}', path))
        actual = {p['name'] for p in parameters if p['in'] == 'path'}
        check(f'{method} {path}: path parameters', expected == actual and all(p.get('required') for p in parameters if p['in'] == 'path'))
        check(f'{method} {path}: responses', bool(op.get('responses')))
        security = op.get('security', api.get('security'))
        if '/worker/' in path:
            check(op['operationId'] + ': worker authentication', security == [{'WorkerToken': []}])
        if method in {'post','put','patch','delete'}:
            headers = {p['name']:p for p in parameters if p['in'] == 'header'}
            if '/auth/login-flows' in path:
                check(op['operationId'] + ': proof instead of idempotency cache', 'Idempotency-Key' not in headers and security == [])
            else:
                check(op['operationId'] + ': idempotency header', headers.get('Idempotency-Key', {}).get('required') is True)
                if any('SessionCookie' in s for s in security or []):
                    check(op['operationId'] + ': conditional CSRF documented', 'X-CSRF-Token' in headers)
check('Unique operation IDs', len(operations) == len(set(operations)))
check('Separate stop-proof and reconciliation APIs', all(p in api['paths'] for p in ['/api/v1/worker/stop-proofs','/api/v1/runs/{run_id}/reconcile']))
check('Run safety fields are required', {'safety_disposition','holds_task_slot'} <= set(schemas['Run']['required']))
check('Immutable worker input manifest is required', 'inputs' in schemas['Lease']['required'])
check('Event contracts agree', schemas['RunEvent']['oneOf'] == events['oneOf'])
event_types = [e['properties']['type']['const'] for e in events['oneOf']]
check('Unique event types', len(event_types) == len(set(event_types)))
state_payload = next(e for e in events['oneOf'] if e['properties']['type']['const'] == 'run.state')['properties']['payload']['properties']
check('Run states agree with state event', all(state_payload[p]['enum'] == schemas['Run']['properties']['state']['enum'] for p in ['from','to']))

by_id = {t['id']: t for t in tasks}
check('Unique task IDs', len(by_id) == len(tasks))
check('No fabricated implementation status', all(t['status'] == 'not_started' for t in tasks))
visited, active, graph_errors = set(), set(), []


def visit(task_id):
    if task_id in active:
        graph_errors.append('Cycle at ' + task_id)
        return
    if task_id in visited:
        return
    active.add(task_id)
    for dependency in by_id[task_id]['depends_on']:
        if dependency not in by_id:
            graph_errors.append('Missing ' + dependency)
        else:
            if by_id[dependency]['release'] > by_id[task_id]['release']:
                graph_errors.append('Later release dependency: ' + task_id)
            visit(dependency)
    active.remove(task_id)
    visited.add(task_id)


for task_id in by_id:
    visit(task_id)
check('Task dependencies exist, acyclic, release-consistent', not graph_errors, str(graph_errors))
task_md = (ROOT / 'TASKS.md').read_text(encoding='utf-8-sig')
for task in tasks:
    check(task['id'] + ': Markdown heading', f"{task['id']} · {task['title']}" in task_md)
    check(task['id'] + ': implementation goal', task['goal'] in task_md)
    check(task['id'] + ': acceptance and scope', bool(task['acceptance']) and bool(task['allowed_paths']))
links_checked = 0
for md in ROOT.rglob('*.md'):
    source = md.read_text(encoding='utf-8-sig')
    check(str(md.relative_to(ROOT)) + ': paired fences', len(re.findall(r'^```',source,re.M)) % 2 == 0)
    for target in re.findall(r'\]\(([^)]+)\)', source):
        target = target.strip('<>')
        if urlsplit(target).scheme or target.startswith(('#','/')) or re.match(r'^[A-Za-z]:',target):
            continue
        relative = unquote(target.split('#')[0])
        if relative:
            links_checked += 1
            check(str(md.relative_to(ROOT)) + ': link ' + relative, (md.parent / relative).exists())

schema_checks = 'not_available'
try:
    from jsonschema import Draft202012Validator, FormatChecker
except ImportError:
    pass
else:
    schema_checks = 'performed'
    for name, schema in schemas.items():
        try:
            Draft202012Validator.check_schema(schema)
            check(name + ': schema syntax', True)
        except Exception as exc:
            check(name + ': schema syntax', False, str(exc))
    Draft202012Validator.check_schema(events)
    uid = '11111111-1111-4111-8111-111111111111'
    stamp = '2026-09-13T12:00:00Z'
    payloads = {
        'run.state': {'from':'running','to':'verifying','reason':'settled'},
        'attempt.activity': {'phase':'editing','summary':'Editing source'},
        'attempt.output': {'stream':'stdout','text':'test output','truncated':False},
        'verification.result': {'status':'inconclusive','artifact_ids':[],'summary':'No tests configured'},
        'artifact.published': {'artifact_id':uid,'kind':'patch','label':'Change patch'},
        'attempt.cost': {'currency':'USD','amount':None,'input_tokens':5,'output_tokens':8},
        'source.changed': {'old_fingerprint':'a','new_fingerprint':'b'},
        'attempt.stopped': {'classification':'blocked','summary':'Needs input','process_tree_stopped':True},
        'review.recorded': {'decision':'reject','principal_id':uid,'reason':'Tests required'},
        'notification.status': {'effect_id':uid,'status':'reconciliation_required'},
    }
    event_validator = Draft202012Validator(events, format_checker=FormatChecker())
    sample = None
    for kind, payload in payloads.items():
        sample = dict(schema_version=1,event_id=uid,run_id=uid,attempt_id=uid,sequence=1,occurred_at=stamp,received_at=stamp,type=kind,payload=payload)
        check(kind + ': valid example', event_validator.is_valid(sample))
        malformed = copy.deepcopy(sample)
        malformed['payload']['unexpected'] = 'reject'
        check(kind + ': rejects extra payload field', not event_validator.is_valid(malformed))
    for field, value in [('sequence',0),('event_id','not-a-uuid'),('type','unknown.event')]:
        invalid = dict(sample, **{field:value})
        check('Event rejects invalid ' + field, not event_validator.is_valid(invalid))
    invalid = copy.deepcopy(sample)
    invalid.update(type='run.state',payload={'from':'running','to':'made_up','reason':'x'})
    check('Event rejects unknown state', not event_validator.is_valid(invalid))

    def validator_for(name):
        return Draft202012Validator({'$ref':'#/components/schemas/'+name,'components':api['components']}, format_checker=FormatChecker())

    sessions = validator_for('Session')
    base = dict(principal_id=uid,expires_at=stamp)
    check('Session cookie example', sessions.is_valid(dict(base,transport='cookie',csrf_token='csrf')))
    check('Session bearer example', sessions.is_valid(dict(base,transport='bearer',access_token='opaque')))
    check('Session forbids token in cookie response', not sessions.is_valid(dict(base,transport='cookie',csrf_token='csrf',access_token='opaque')))
    check('Session forbids missing bearer', not sessions.is_valid(dict(base,transport='bearer')))
    criteria = schemas['SpecificationCreate']['properties']['acceptance_criteria']
    check('Specification rejects empty acceptance list', not Draft202012Validator(criteria).is_valid([]))
    reconcile = validator_for('Reconcile')
    check('Reconciliation requires evidence', not reconcile.is_valid({'disposition':'stopped','reason':'claim','evidence_ids':[]}))
    check('Reconciliation evidence example', reconcile.is_valid({'disposition':'isolated','reason':'Device isolated','evidence_ids':[uid]}))

inputs = {p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in ROOT.rglob('*') if p.is_file() and p.name not in {'validation-report.json','.finish-contracts.py'} and not {'.git','__pycache__','.venv','node_modules'}.intersection(p.relative_to(ROOT).parts)}
report = {
    'generated_at':datetime.now(timezone.utc).isoformat(),
    'scope':'Specification structure and schema examples only; no application/runtime tests',
    'passed':all(c['passed'] for c in CHECKS),
    'counts':dict(operations=len(operations),schemas=len(schemas),event_types=len(event_types),tasks=len(tasks),relative_links=links_checked,checks=len(CHECKS)),
    'jsonschema_checks':schema_checks,
    'full_third_party_openapi_validation':'not_performed',
    'input_sha256':inputs,
    'checks':CHECKS,
}
(ROOT / 'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
failures = [c for c in CHECKS if not c['passed']]
print(json.dumps({k:report[k] for k in ['passed','scope','counts','jsonschema_checks']},ensure_ascii=False))
for failure in failures:
    print(json.dumps(failure,ensure_ascii=False))
sys.exit(1 if failures else 0)
