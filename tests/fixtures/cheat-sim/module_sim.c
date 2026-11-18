#include <windows.h>
/* An unsigned library that names dota2.exe, like an internal cheat DLL. DllMain does nothing. */
__declspec(dllexport) const char *arenahub_fixture_target = "dota2.exe";
BOOL WINAPI DllMain(HINSTANCE instance, DWORD reason, LPVOID reserved) { (void)instance; (void)reason; (void)reserved; return TRUE; }
