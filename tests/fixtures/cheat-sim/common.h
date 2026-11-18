/* ArenaHub harmless cheat simulators. They copy the TRAITS of cheat software (names, imports, sections,
 * version resources) so the detector can be tested without real cheats. None of them reads or writes another
 * process, injects anything or touches Dota 2. With --wait N they idle for N seconds so tests can see them run. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <windows.h>
static int fixture_main(int argc, char **argv, const char *what) {
  printf("ArenaHub harmless test fixture (%s). It does nothing.\n", what);
  fflush(stdout);
  if (argc >= 3 && strcmp(argv[1], "--wait") == 0) Sleep((DWORD)atoi(argv[2]) * 1000);
  return 0;
}
