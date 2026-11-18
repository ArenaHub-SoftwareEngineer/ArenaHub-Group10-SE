#include "common.h"
/* Loads one library by path and idles, standing in for a game process that a library was loaded into. */
int main(int argc, char **argv) {
  if (argc < 3) return 2;
  if (!LoadLibraryA(argv[1])) { printf("load failed %lu\n", GetLastError()); return 1; }
  printf("ArenaHub harmless host loaded the fixture library.\n");
  fflush(stdout);
  Sleep((DWORD)atoi(argv[2]) * 1000);
  return 0;
}
