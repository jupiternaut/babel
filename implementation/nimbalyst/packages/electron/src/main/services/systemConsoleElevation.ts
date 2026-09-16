/** Only main-owned paths enter this command. Single quote escaping handles spaces/apostrophes. */
export function systemConsoleElevationCommand(
  executable: string,
  entry: string,
  profile: string,
  windowsScript: string
): string {
  const quote = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = `$env:ELECTRON_RUN_AS_NODE='1'; $env:BABEL_SYSTEM_PROFILE=${quote(
    profile
  )}; $env:BABEL_SYSTEM_WINDOWS_SCRIPT=${quote(
    windowsScript
  )}; $env:BABEL_SYSTEM_PORT='7782'; & ${quote(executable)} ${quote(
    entry
  )} >> ${quote(`${profile}\\server-admin.log`)} 2>&1`;
  const encoded = Buffer.from(script, "utf16le").toString("base64");
  return `Start-Process -FilePath powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}' -ErrorAction Stop`;
}
