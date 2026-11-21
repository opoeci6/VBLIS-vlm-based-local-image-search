import { Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ModelCard } from './ModelCard';
import { useReplica } from '../../session/replicaContext';
import { SectionTitle } from './SectionTitle';

export const ModelManagementSection = ({ models, status, pendingModel, uiTheme, handleUnloadModel, isUnloadingModel, handleModelSwitch, isSwitchingModel, setPendingModel, handleDownloadModel, handleCancelDownload, showConfirmDeleteModel, setShowConfirmDeleteModel, deleteIndexWithModel, setDeleteIndexWithModel, handleDeleteModel, isDeletingModel }) => {
  const { t } = useTranslation('settings');
  // A read-only copy can only use the model its index was made with: the others are not offered.
  const { replica } = useReplica();
  const ownModel = replica?.model_id || null;
  const shownModels = ownModel ? (models.models || []).filter(m => m.id === ownModel) : models.models;
  return (
    <div>
      <SectionTitle className="mb-1">{t('modelManagement.title')}</SectionTitle>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-3 leading-relaxed italic">
        {t('modelManagement.description')}
      </p>
      {ownModel && (
        <p className="text-[11px] text-neutral-500 dark:text-neutral-400 mb-3 leading-relaxed">{t('replica:onlyOwnModel')}</p>
      )}
      {!models.models || models.models.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-neutral-600 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {shownModels?.map(m => (
            <ModelCard
              key={m.id}
              m={m}
              models={models}
              status={status}
              pendingModel={pendingModel}
              uiTheme={uiTheme}
              handleUnloadModel={handleUnloadModel}
              isUnloadingModel={isUnloadingModel}
              handleModelSwitch={handleModelSwitch}
              isSwitchingModel={isSwitchingModel}
              setPendingModel={setPendingModel}
              handleDownloadModel={handleDownloadModel}
              handleCancelDownload={handleCancelDownload}
              showConfirmDeleteModel={showConfirmDeleteModel}
              setShowConfirmDeleteModel={setShowConfirmDeleteModel}
              deleteIndexWithModel={deleteIndexWithModel}
              setDeleteIndexWithModel={setDeleteIndexWithModel}
              handleDeleteModel={handleDeleteModel}
              isDeletingModel={isDeletingModel}
            />
          ))}
        </div>
      )}
    </div>
  );
};
