// Customer portal (Wave 4 W4E: US-8-01, US-8-02). Public surface of src/modules/portal.
// Portal code receives a PortalAuthContext; staff code (admin.ts) receives the internal AuthContext.
export { PORTAL_CAPABILITIES, PORTAL_ROLE_BUNDLES, capabilitiesFor, isPortalRole, type PortalCapability, type PortalRole } from "./capabilities";
export { PortalAuthContext, isPortalContext } from "./context";
export { PORTAL_TENANT_STATUS_LABEL, PORTAL_TENANT_TRANSITIONS, PORTAL_USER_STATUS_LABEL, PORTAL_USER_TRANSITIONS, canPortalUserTransition, type PortalTenantStatus, type PortalUserStatus } from "./states";
export { createPortalSession, validatePortalSessionToken, revokePortalUserSessions, type PortalSessionRow } from "./sessions";
export { buildPortalContext, limitPortalUnauthenticated, limitPortalUser } from "./support";
export {
  acceptPortalInvitation,
  beginPortalTotp,
  changePortalPassword,
  completePortalMfa,
  confirmPortalTotp,
  disablePortalTotp,
  inspectPortalInvitation,
  portalAccountState,
  signInPortal,
  signOutPortal,
  type PortalSignInResult,
  type PortalTokenState,
} from "./auth";
export { catalogueFor, portalCatalogue, unitPriceFor, type PortalCatalogItem } from "./catalog";
export {
  PORTAL_ORDER_STATUS_LABEL,
  getPortalOrder,
  listPortalOrders,
  placePortalOrder,
  portalAddresses,
  portalStatusLabel,
  portalStatusTone,
  reorderCart,
  type PlacedPortalOrder,
  type PortalOrderDetail,
  type PortalOrderInput,
  type PortalOrderRow,
} from "./orders";
export { getPortalDocument, listPortalDocuments, portalDocumentHref, portalDocumentKinds, registerPortalDocumentSource, type PortalDocumentSource, type PortalDocumentSummary, type PortalDocumentView } from "./documents";
export {
  addPortalCatalogItem,
  changePortalUser,
  enablePortal,
  getPortalAccess,
  invitePortalUser,
  portalInvitationLink,
  removePortalCatalogItem,
  resendPortalInvitation,
  setPortalCatalogMode,
  setPortalTenantStatus,
  type PortalAccessView,
  type PortalDelivery,
} from "./admin";
export { listPortalDemoAccounts, signInPortalAsDemo, type PortalDemoAccount } from "./demo";
export {
  PORTAL_COOKIE,
  PORTAL_MFA_COOKIE,
  clearPortalCookie,
  clearPortalMfaCookie,
  getPortalContext,
  portalContextFromRequest,
  portalTokenFromRequest,
  readPortalMfaToken,
  readPortalToken,
  requirePortalContext,
  setPortalCookie,
  setPortalMfaCookie,
} from "./cookie";
