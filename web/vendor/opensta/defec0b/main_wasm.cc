// Nishkam: minimal OpenSTA entry point (no readline, no threads). Usage: sta.js script.tcl
#include <tcl.h>
#include <cstdio>
#include <cstdlib>
#include "Sta.hh"
#include "StaMain.hh"
namespace sta { extern const char *tcl_inits[]; }
extern "C" { extern int Sta_Init(Tcl_Interp *interp); }
int main(int argc, char **argv) {
  setenv("TCL_LIBRARY", "/tcl8.6", 1);
  Tcl_FindExecutable(argv[0]);
  Tcl_Interp *interp = Tcl_CreateInterp();
  if (Tcl_Init(interp) == TCL_ERROR) { fprintf(stderr, "Tcl_Init: %s\n", Tcl_GetStringResult(interp)); return 1; }
  sta::initSta();
  sta::Sta *s = new sta::Sta;
  sta::Sta::setSta(s);
  s->makeComponents();
  s->setTclInterp(interp);
  s->setThreadCount(1);
  Sta_Init(interp);
  sta::evalTclInit(interp, sta::tcl_inits);
  Tcl_Eval(interp, "init_sta_cmds");
  if (argc < 2) return 0;
  int r = Tcl_EvalFile(interp, argv[1]);
  if (r != TCL_OK) { fprintf(stderr, "Error: %s\n", Tcl_GetStringResult(interp)); return 1; }
  return 0;
}
