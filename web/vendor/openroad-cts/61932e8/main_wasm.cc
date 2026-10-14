#include <tcl.h>
#include <cstdio>
#include <cstdlib>
#define private public
#include "ord/OpenRoad.hh"
#undef private
#include "ord/InitOpenRoad.hh"
int main(int argc, char** argv)
{
  setenv("TCL_LIBRARY", "/tcl8.6", 1);
  Tcl_FindExecutable(argv[0]);
  Tcl_Interp* interp = Tcl_CreateInterp();
  if (Tcl_Init(interp) == TCL_ERROR) { fprintf(stderr, "Tcl_Init: %s\n", Tcl_GetStringResult(interp)); return 1; }
  ord::OpenRoad* app = new ord::OpenRoad();
  ord::OpenRoad::setOpenRoad(app);
  ord::initOpenRoad(interp, nullptr, nullptr, true);
  if (argc < 2) return 0;
  int r = Tcl_EvalFile(interp, argv[1]);
  if (r != TCL_OK) { fprintf(stderr, "Error: %s\n", Tcl_GetStringResult(interp)); return 1; }
  return 0;
}
