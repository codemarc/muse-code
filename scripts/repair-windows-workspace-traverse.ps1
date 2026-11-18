# Preview by default. -Apply requires explicit approval for the displayed paths,
# principals and rights. Never grants file read/write or inherited permissions.
param(
  [Parameter(Mandatory=$true)][string]$WorkspacePath,
  [switch]$Apply,
  [string]$BackupPath
)
$ErrorActionPreference = 'Stop'
$profileRoot = (Resolve-Path -LiteralPath $env:USERPROFILE).ProviderPath.TrimEnd('\')
$workspaceRoot = (Resolve-Path -LiteralPath $WorkspacePath).ProviderPath.TrimEnd('\')
if (-not $workspaceRoot.StartsWith($profileRoot + '\', [StringComparison]::OrdinalIgnoreCase)) {
  throw 'This repair only handles workspace ancestors inside the current user profile.'
}
$paths = @()
$ancestor = Split-Path -Parent $workspaceRoot
while ($ancestor.Length -ge $profileRoot.Length) {
  $item = Get-Item -LiteralPath $ancestor -Force
  if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) {
    # OneDrive Cloud placeholders do not redirect names. Accept only Microsoft's
    # CLOUD / CLOUD_1..F tags; reject junctions, symlinks and unknown tags.
    $reparseInfo = (& fsutil reparsepoint query $ancestor 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0 -or $reparseInfo -notmatch '0x(9000[0-9a-fA-F]01[aA])\b') {
      throw "Refusing a redirecting or unknown reparse point: $ancestor"
    }
  }
  $paths += $ancestor
  if ($ancestor -ieq $profileRoot) { break }
  $ancestor = Split-Path -Parent $ancestor
}
if ($paths[-1] -ine $profileRoot) { throw 'Ancestor validation failed.' }
$setupRoot = Join-Path $env:ProgramData 'muse\windows-elevated-sandbox'
$capabilities = Get-Content -LiteralPath (Join-Path $setupRoot 'capabilities.json') -Raw | ConvertFrom-Json
$groupSid = [Security.Principal.NTAccount]::new('MuseSandboxUsers').Translate([Security.Principal.SecurityIdentifier])
$capabilitySid = [Security.Principal.SecurityIdentifier]::new($capabilities.readonly_sid)
$principals = @($groupSid, $capabilitySid)
$rights = [Security.AccessControl.FileSystemRights]::Traverse -bor [Security.AccessControl.FileSystemRights]::ReadAttributes
$plan = [pscustomobject]@{
  Workspace = $workspaceRoot
  Paths = $paths
  Principals = @($principals | ForEach-Object Value)
  Rights = 'Traverse, ReadAttributes (Allow ACE also carries Synchronize)'
  Inheritance = 'None'
  Apply = [bool]$Apply
}
$plan | ConvertTo-Json -Depth 4
if (-not $Apply) { return }
if ([string]::IsNullOrWhiteSpace($BackupPath)) { throw '-BackupPath is required when applying the repair.' }
if (Test-Path -LiteralPath $BackupPath) { throw 'Use a new backup filename; existing backups are never overwritten.' }
$backup = @($paths | ForEach-Object { [pscustomobject]@{ Path=$_; Sddl=(Get-Acl -LiteralPath $_).Sddl } })
$backup | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath $BackupPath -Encoding UTF8
# Set-Acl uses SetNamedSecurityInfo, which reprocesses existing inherited ACEs
# throughout the child tree even when the new ACE is not inheritable. This
# target-only API deliberately avoids that propagation for this narrow repair.
if (-not ('MuseTargetOnlyAcl' -as [type])) {
  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class MuseTargetOnlyAcl {
  [DllImport("advapi32.dll", EntryPoint="SetFileSecurityW", CharSet=CharSet.Unicode, SetLastError=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  public static extern bool SetDacl(string path, uint information, byte[] descriptor);
}
'@
}
function Set-TargetOnlyDacl($Path, $Acl) {
  if (-not [MuseTargetOnlyAcl]::SetDacl($Path, 4, $Acl.GetSecurityDescriptorBinaryForm())) {
    throw [ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  }
}
$changed = @()
try {
  foreach ($path in $paths) {
    $acl = Get-Acl -LiteralPath $path
    foreach ($principal in $principals) {
      $rule = [Security.AccessControl.FileSystemAccessRule]::new($principal, $rights,
        [Security.AccessControl.InheritanceFlags]::None, [Security.AccessControl.PropagationFlags]::None,
        [Security.AccessControl.AccessControlType]::Allow)
      $acl.AddAccessRule($rule)
    }
    Set-TargetOnlyDacl $path $acl
    $changed += [pscustomobject]@{Path=$path; AppliedSddl=(Get-Acl -LiteralPath $path).Sddl}
    Write-Output "Applied target-only traversal ACL: $path"
  }
} catch {
  $failure = $_
  foreach ($entry in $changed) {
    $current = Get-Acl -LiteralPath $entry.Path
    if ($current.Sddl -cne $entry.AppliedSddl) { Write-Warning "ACL changed concurrently; review backup before restoring $($entry.Path)"; continue }
    $original = $backup | Where-Object Path -EQ $entry.Path
    $current.SetSecurityDescriptorSddlForm($original.Sddl, [Security.AccessControl.AccessControlSections]::Access)
    Set-TargetOnlyDacl $entry.Path $current
  }
  throw $failure
}
