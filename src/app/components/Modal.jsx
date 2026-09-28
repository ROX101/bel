import { useApp } from '../store.jsx';
import { NewAssetModal, StartReviewModal, CancelReviewModal } from './modals/ReviewModals.jsx';
import ReviewDetailModal from './modals/ReviewDetailModal.jsx';
import { JustifyModal, TransferModal } from './modals/CustodyModal.jsx';
import EmployeeProfileModal from './modals/EmployeeProfileModal.jsx';
import AssetProfileModal from './modals/AssetProfileModal.jsx';
import RegisterEmployeeModal from './modals/RegisterEmployeeModal.jsx';
import RolesModal from './modals/RolesModal.jsx';
import OrgChartModal from './modals/OrgChartModal.jsx';
import { CredentialsIssuedModal, DeactivateIdentityModal, OnboardSuccessModal } from './modals/MiscModals.jsx';

// Dispatcher — real JSX port of app.js's renderModal()/renderReviewModal()/
// renderCustodyModal() dispatch chain: one component per State.modal.type.
export default function Modal() {
  const { State } = useApp();
  const m = State.modal;
  if (!m) return null;
  switch (m.type) {
    case 'new-asset': return <NewAssetModal m={m} />;
    case 'start-review': return <StartReviewModal m={m} />;
    case 'review-detail': return <ReviewDetailModal m={m} />;
    case 'cancel-review': return <CancelReviewModal m={m} />;
    case 'download-justify':
    case 'retire-nft': return <JustifyModal m={m} />;
    case 'transfer-custody':
    case 'recover-custody': return <TransferModal m={m} />;
    case 'employee-profile': return <EmployeeProfileModal m={m} />;
    case 'asset-profile': return <AssetProfileModal m={m} />;
    case 'register-employee': return <RegisterEmployeeModal />;
    case 'roles': return <RolesModal />;
    case 'full-org-chart': return <OrgChartModal />;
    case 'credentials-issued': return <CredentialsIssuedModal m={m} />;
    case 'deactivate-identity': return <DeactivateIdentityModal m={m} />;
    case 'onboard-success': return <OnboardSuccessModal m={m} />;
    default: return null;
  }
}
