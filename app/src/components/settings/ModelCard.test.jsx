import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelCard } from './ModelCard';

const makeProps = (overrides = {}) => ({
  m: { id: 'org/model-a', downloaded: true },
  models: { active_model: '', models: [] },
  status: { is_downloading: false, is_indexing: false },
  pendingModel: 'org/other',
  uiTheme: 'modern',
  handleUnloadModel: vi.fn(),
  isUnloadingModel: false,
  handleModelSwitch: vi.fn(),
  isSwitchingModel: false,
  setPendingModel: vi.fn(),
  handleDownloadModel: vi.fn(),
  handleCancelDownload: vi.fn(),
  showConfirmDeleteModel: null,
  setShowConfirmDeleteModel: vi.fn(),
  deleteIndexWithModel: false,
  setDeleteIndexWithModel: vi.fn(),
  handleDeleteModel: vi.fn(),
  isDeletingModel: false,
  ...overrides,
});

const renderCard = (overrides) => {
  const props = makeProps(overrides);
  return { props, ...render(<ModelCard {...props} />) };
};

describe('ModelCard', () => {
  afterEach(cleanup);

  describe('active model', () => {
    const active = () => ({ models: { active_model: 'org/model-a', models: [] } });

    it.each(['modern', 'terminal'])('shows the Active badge and ejects (%s)', (uiTheme) => {
      const { props } = renderCard({ ...active(), uiTheme });
      expect(screen.getByText('model-a')).toBeTruthy();
      expect(screen.getByText('Ready to use')).toBeTruthy();
      expect(screen.getByText('Active')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: /Eject/ }));
      expect(props.handleUnloadModel).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: /Activate/ })).toBeNull();
    });

    it('disables Eject while indexing and shows progress while unloading', () => {
      const { unmount } = renderCard({ ...active(), status: { is_downloading: false, is_indexing: true } });
      expect(screen.getByRole('button', { name: /Eject/ }).disabled).toBe(true);
      expect(screen.getByRole('button', { name: /Eject/ }).title).toContain('Cannot eject model while indexing');
      unmount();

      renderCard({ ...active(), isUnloadingModel: true });
      expect(screen.getByRole('button', { name: /Unloading/ }).disabled).toBe(true);
    });
  });

  describe('downloaded but inactive', () => {
    it('activates the model', () => {
      const { props } = renderCard();
      fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
      expect(props.handleModelSwitch).toHaveBeenCalledWith('org/model-a');
    });

    it('shows "..." only for the model being switched to', () => {
      const { unmount } = renderCard({ isSwitchingModel: true, pendingModel: 'org/model-a' });
      expect(screen.getByRole('button', { name: '...' })).toBeTruthy();
      unmount();

      renderCard({ isSwitchingModel: true, pendingModel: 'org/other' });
      expect(screen.getByRole('button', { name: 'Activate' }).disabled).toBe(true);
    });

    it('disables Activate while indexing or downloading', () => {
      const { unmount } = renderCard({ status: { is_downloading: false, is_indexing: true } });
      expect(screen.getByRole('button', { name: 'Activate' }).disabled).toBe(true);
      unmount();
      renderCard({ status: { is_downloading: true, is_indexing: false } });
      expect(screen.getByRole('button', { name: 'Activate' }).disabled).toBe(true);
    });
  });

  describe('downloading', () => {
    const downloading = (extra = {}) => ({
      m: { id: 'org/model-a', downloaded: false },
      pendingModel: 'org/model-a',
      status: {
        is_downloading: true, is_indexing: false, download_current_bytes: 500, download_total_bytes: 1000,
        download_speed: 2048, cancel_download: false, ...extra,
      },
    });

    it('shows progress and a Cancel button', () => {
      const { props } = renderCard(downloading());
      expect(screen.getByText('Downloading...')).toBeTruthy();
      expect(screen.getByText('2 KB/s')).toBeTruthy();
      expect(screen.getByText(/Downloading \(500 B \/ 1000 B\)/)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(props.handleCancelDownload).toHaveBeenCalledTimes(1);
    });

    it('shows "Cancelling..." and disables the button once cancelling', () => {
      renderCard(downloading({ cancel_download: true }));
      expect(screen.getByRole('button', { name: 'Cancelling...' }).disabled).toBe(true);
    });

    it('hides the delete action while downloading', () => {
      renderCard(downloading());
      expect(screen.queryByTitle(/Delete/)).toBeNull();
    });
  });

  describe('incomplete and not downloaded', () => {
    it('offers Resume for an incomplete download', () => {
      const { props } = renderCard({
        m: { id: 'org/model-a', downloaded: false, incomplete: true, download_current_bytes: 100, download_total_bytes: 400 },
      });
      expect(screen.getByText(/Incomplete \(100 B \/ 400 B\)/)).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Resume/ }));
      expect(props.setPendingModel).toHaveBeenCalledWith('org/model-a');
      expect(props.handleDownloadModel).toHaveBeenCalledWith('org/model-a');
    });

    it('offers Download for a model that is not downloaded', () => {
      const { props } = renderCard({ m: { id: 'org/model-b', downloaded: false } });
      expect(screen.getByText('Not Downloaded')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Download' }));
      expect(props.setPendingModel).toHaveBeenCalledWith('org/model-b');
      expect(props.handleDownloadModel).toHaveBeenCalledWith('org/model-b');
      expect(screen.queryByTitle(/Delete/)).toBeNull();
    });

    it('disables Download while another download runs', () => {
      renderCard({ m: { id: 'org/model-b', downloaded: false }, status: { is_downloading: true, is_indexing: false } });
      expect(screen.getByRole('button', { name: 'Download' }).disabled).toBe(true);
    });
  });

  describe('delete flow', () => {
    it('asks for confirmation from the trash button', () => {
      const { props } = renderCard();
      fireEvent.click(screen.getByTitle('Delete local files'));
      expect(props.setShowConfirmDeleteModel).toHaveBeenCalledWith('org/model-a');
    });

    it('uses a different tooltip for partial files', () => {
      renderCard({ m: { id: 'org/model-a', downloaded: false, incomplete: true } });
      expect(screen.getByTitle('Delete partial files')).toBeTruthy();
    });

    it('is hidden while indexing', () => {
      renderCard({ status: { is_downloading: false, is_indexing: true } });
      expect(screen.queryByTitle('Delete local files')).toBeNull();
    });

    it('shows the Wipe Index checkbox for downloaded models and toggles it', () => {
      const { props } = renderCard({ showConfirmDeleteModel: 'org/model-a' });
      expect(screen.getByText('Wipe Index')).toBeTruthy();
      fireEvent.click(screen.getByRole('checkbox'));
      expect(props.setDeleteIndexWithModel).toHaveBeenCalledWith(true);
    });

    it('omits the checkbox for incomplete models', () => {
      renderCard({ m: { id: 'org/model-a', downloaded: false, incomplete: true }, showConfirmDeleteModel: 'org/model-a' });
      expect(screen.queryByRole('checkbox')).toBeNull();
    });

    it('deletes with "Del" and cancels with "X"', () => {
      const { props } = renderCard({ showConfirmDeleteModel: 'org/model-a' });
      fireEvent.click(screen.getByRole('button', { name: 'Del' }));
      expect(props.handleDeleteModel).toHaveBeenCalledWith('org/model-a');

      fireEvent.click(screen.getByRole('button', { name: 'X' }));
      expect(props.setShowConfirmDeleteModel).toHaveBeenCalledWith(null);
    });

    it('shows "..." and disables Del while deleting', () => {
      renderCard({ showConfirmDeleteModel: 'org/model-a', isDeletingModel: true });
      const buttons = screen.getAllByRole('button', { name: '...' });
      expect(buttons.some(b => b.disabled)).toBe(true);
    });

    it('only shows the confirm UI on the matching card', () => {
      renderCard({ showConfirmDeleteModel: 'org/another' });
      expect(screen.queryByRole('button', { name: 'Del' })).toBeNull();
      expect(screen.getByTitle('Delete local files')).toBeTruthy();
    });
  });
});
