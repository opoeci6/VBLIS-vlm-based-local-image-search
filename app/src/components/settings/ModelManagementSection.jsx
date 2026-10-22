import { Loader2 } from 'lucide-react';
import { ModelCard } from './ModelCard';

export const ModelManagementSection = ({ models, status, pendingModel, uiTheme, handleUnloadModel, isUnloadingModel, handleModelSwitch, isSwitchingModel, setPendingModel, handleDownloadModel, handleCancelDownload, showConfirmDeleteModel, setShowConfirmDeleteModel, deleteIndexWithModel, setDeleteIndexWithModel, handleDeleteModel, isDeletingModel }) => {
  return (
    <div className="pt-2">
      <label className="block text-sm font-semibold text-neutral-500 dark:text-neutral-400 mb-0.5">Model Management</label>
      <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-3 leading-relaxed italic">
        Each model has its own index. Switching models may require reindexing.
      </p>
      {!models.models || models.models.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 text-neutral-600 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3">
          {models.models?.map(m => (
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
