import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  SAMPLE_PDF,
  SAMPLE_PDF_V2,
  annotateParagraph,
  attachTestTranslation,
  bindAnchorToTask,
  locateBilingual,
  locateParagraph,
  remapAnchor,
  translationSourceOf,
} from "../src/gateway/pdf-anchors.ts";
import { IsolatedSftpTree } from "../src/gateway/remote-files.ts";

const temps: string[] = [];
afterEach(() => {
  while (temps.length) {
    const dir = temps.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

describe("PDF anchors and isolated SFTP tree", () => {
  it("locates a quote and marks translation as test-fixture", () => {
    const anchor = locateParagraph(SAMPLE_PDF, "approved 不等于完成");
    expect(anchor?.paragraphId).toBe("p-2");
    expect(anchor?.revision).toBe(1);
    const translated = attachTestTranslation(SAMPLE_PDF, "p-2", "approved is not done");
    expect(translated.pages[0]?.paragraphs[1]?.translation?.source).toBe("test-fixture");
  });

  it("remaps an anchor across revisions and binds it to a tracker id", () => {
    const first = locateParagraph(SAMPLE_PDF, "approved 不等于完成");
    expect(first).not.toBeNull();
    const remapped = remapAnchor(first!, SAMPLE_PDF_V2);
    expect(remapped?.revision).toBe(2);
    expect(remapped?.paragraphId).toBe("p-2");
    const ref = bindAnchorToTask("trk-pdf-demo", remapped!);
    expect(ref.trackerId).toBe("trk-pdf-demo");
    expect(ref.anchor.revision).toBe(2);
    const translated = attachTestTranslation(SAMPLE_PDF_V2, "p-2", "approved is not done");
    expect(translationSourceOf(translated, "p-2")).toBe("test-fixture");
    expect(translationSourceOf(SAMPLE_PDF, "p-2")).toBeNull();
    const bilingual = locateBilingual(translated, "approved is not done");
    expect(bilingual?.paragraphId).toBe("p-2");
    const note = annotateParagraph(SAMPLE_PDF_V2, "p-1", "引用到任务，不是真实翻译");
    expect(note?.source).toBe("test-fixture");
    expect(note?.anchor.paragraphId).toBe("p-1");
  });

  it("assigns a stable resource id and blocks path escape", () => {
    const root = mkdtempSync(path.join(tmpdir(), "babel-sftp-"));
    temps.push(root);
    writeFileSync(path.join(root, "note.txt"), "hello", "utf8");
    const tree = new IsolatedSftpTree(root);
    const resource = tree.resolve("note.txt");
    expect(resource.resourceId).toBe("sftp:note.txt");
    expect(resource.readonly).toBe(true);
    expect(() => tree.resolve("../secret")).toThrow(/穿越/);
  });
});
