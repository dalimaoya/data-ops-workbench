; Inno Setup Script for 数据运维工作台
; Compile with: iscc /DMyAppVersion=v5.0.0 setup.iss

#ifndef MyAppVersion
  #define MyAppVersion "v5.0.0"
#endif

[Setup]
AppId={{E8F3A1B2-5C6D-4E7F-8A9B-0C1D2E3F4A5B}
AppName=数据运维工作台
AppVersion={#MyAppVersion}
AppPublisher=DataOps Team
AppContact=ops@aiusing.net
AppSupportURL=https://github.com/dalimaoya/data-ops-workbench-pro
DefaultDirName={autopf}\DataOpsWorkbench
DefaultGroupName=数据运维工作台
AllowNoIcons=yes
OutputDir=dist
OutputBaseFilename=DataOpsWorkbench-{#MyAppVersion}-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
UninstallDisplayName=数据运维工作台 {#MyAppVersion}
UninstallDisplayIcon={app}\DataOpsWorkbench.exe
ArchitecturesInstallIn64BitMode=x64compatible
SetupIconFile=icon.ico
MinVersion=10.0

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加图标:"; Flags: checked
Name: "startupicon"; Description: "开机自动启动"; GroupDescription: "系统设置:"; Flags: unchecked

[Files]
; 主入口（pywebview + 控制面板）
Source: "dist\DataOpsWorkbench\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
; 版本文件
Source: "version.txt"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
Name: "{app}\data"; Permissions: users-full
Name: "{app}\backups"; Permissions: users-full
Name: "{app}\logs"; Permissions: users-full

[Icons]
; 开始菜单
Name: "{group}\数据运维工作台"; Filename: "{app}\DataOpsWorkbench.exe"; IconFilename: "{app}\icon.ico"
Name: "{group}\卸载数据运维工作台"; Filename: "{uninstallexe}"
; 桌面快捷方式
Name: "{autodesktop}\数据运维工作台"; Filename: "{app}\DataOpsWorkbench.exe"; IconFilename: "{app}\icon.ico"; Tasks: desktopicon

[Registry]
; 应用信息
Root: HKCU; Subkey: "Software\DataOpsWorkbench"; ValueType: string; ValueName: "InstallPath"; ValueData: "{app}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\DataOpsWorkbench"; ValueType: string; ValueName: "Version"; ValueData: "{#MyAppVersion}"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\DataOpsWorkbench"; ValueType: dword; ValueName: "Port"; ValueData: "9590"; Flags: uninsdeletekey
; 开机自启（仅用户勾选时）
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "DataOpsWorkbench"; ValueData: """{app}\DataOpsWorkbench.exe"""; Flags: uninsdeletevalue; Tasks: startupicon

[Run]
Filename: "{app}\DataOpsWorkbench.exe"; Description: "立即启动数据运维工作台"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; 清理日志和备份（始终删除）
Type: filesandirs; Name: "{app}\logs"
Type: filesandirs; Name: "{app}\backups"
Type: filesandirs; Name: "{app}\__pycache__"

[Code]
// 卸载时询问用户是否保留 data/ 目录
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
  begin
    if DirExists(ExpandConstant('{app}\data')) then
    begin
      if MsgBox('是否保留用户数据目录（data/）？' + #13#10 +
                '其中包含数据库配置、数据源信息等。' + #13#10 + #13#10 +
                '选择"是"保留数据，选择"否"彻底删除。',
                mbConfirmation, MB_YESNO) = IDNO then
      begin
        DelTree(ExpandConstant('{app}\data'), True, True, True);
      end;
    end;
    // 如果整个安装目录为空，删除它
    RemoveDir(ExpandConstant('{app}'));
  end;
end;
