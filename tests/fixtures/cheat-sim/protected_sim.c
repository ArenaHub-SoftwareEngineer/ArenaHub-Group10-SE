#include "common.h"
/* A section with VMProtect's name; real protectors put encrypted code there. This one holds a string. */
__attribute__((section(".vmp0"), used)) const char marker[] = "protector section marker";
int main(int argc, char **argv) { return fixture_main(argc, argv, marker); }
