#include "common.h"
/* Taking the addresses puts the classic injector functions in the import table. They are never called. */
void * volatile imported[] = { (void *)OpenProcess, (void *)VirtualAllocEx, (void *)WriteProcessMemory, (void *)CreateRemoteThread };
const char *target = "dota2.exe";
int main(int argc, char **argv) { return fixture_main(argc, argv, target[0] ? "injector traits" : ""); }
