// wasm spike: minimal grt::GlobalRouter stand-in (no routing). Only what est/rsz call when no routes exist.
#define private public
#define protected public
#include "grt/GlobalRouter.h"
#undef private
#undef protected
#include <cstdlib>
#include "db_sta/dbNetwork.hh"
#include "db_sta/dbSta.hh"
#include "sta/Liberty.hh"
namespace grt {
GlobalRouter* makeStubGlobalRouter(odb::dbDatabase* db, sta::dbSta* sta)
{
  auto* g = (GlobalRouter*) calloc(1, sizeof(GlobalRouter));
  g->db_ = db;
  g->sta_ = sta;
  return g;
}
bool GlobalRouter::haveRoutes() { return false; }
void GlobalRouter::setVerbose(bool) {}
void GlobalRouter::startIncremental() {}
void GlobalRouter::endIncremental(bool) {}
bool GlobalRouter::isNonLeafClock(odb::dbNet* db_net)
{
  sta::dbNetwork* network = sta_->getDbNetwork();
  if (db_net->getSigType() != odb::dbSigType::CLOCK) return false;
  for (odb::dbITerm* iterm : db_net->getITerms()) {
    const sta::Pin* pin = network->dbToSta(iterm);
    sta::LibertyPort* lp = network->libertyPort(pin);
    bool pad = false;
    if (lp && lp->libertyCell()) pad = lp->libertyCell()->isPad();
    if (lp && (lp->isRegClk() || pad)) return false;
  }
  return true;
}
int GlobalRouter::getMinRoutingLayer()
{
  if (block_ == nullptr) block_ = db_->getChip()->getBlock();
  return block_->getMinRoutingLayer();
}
void GlobalRouter::getNetLayerRange(odb::dbNet*, int&, int&) { abort(); }
std::vector<PinGridLocation> GlobalRouter::getPinGridPositions(odb::dbNet*) { abort(); }
NetRouteMap& GlobalRouter::getRoutes() { abort(); }
NetRouteMap GlobalRouter::getPartialRoutes() { abort(); }
IncrementalGRoute::IncrementalGRoute(GlobalRouter* g, odb::dbBlock*) : db_cbk_(g) { abort(); }
IncrementalGRoute::~IncrementalGRoute() {}
std::vector<Net*> IncrementalGRoute::updateRoutes(bool) { abort(); }
bool operator==(const RoutePt&, const RoutePt&) { abort(); }
bool operator<(const RoutePt&, const RoutePt&) { abort(); }
}  // namespace grt
