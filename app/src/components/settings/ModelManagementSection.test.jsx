import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ModelManagementSection } from './ModelManagementSection';

const makeProps = (overrides = {}) => ({
  models: {
    active_model: 'org/model-a',
    models: [
      { id: 'org/model-a', downloaded: true },
      { id: 'org/model-b', downloaded: true },
      { id: 'org/model-c', downloaded: false },
    ],
  },
  status: { is_downloading: false, is_indexing: false },
  pendingModel: 'org/model-a',
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

describe('ModelManagementSection', () => {
  afterEach(cleanup);

  it.each([
    ['no models list', { models: { active_model: '' } }],
    ['an empty models list', { models: { active_model: '', models: [] } }],
  ])('shows a loader with %s', (_label, overrides) => {
    const { container } = render(<ModelManagementSection {...makeProps(overrides)} />);
    expect(screen.getByText('Model Management')).toBeTruthy();
    expect(container.querySelector('.animate-spin')).toBeTruthy();
  });

  it('renders one card per model', () => {
    render(<ModelManagementSection {...makeProps()} />);
    expect(screen.getByText('model-a')).toBeTruthy();
    expect(screen.getByText('model-b')).toBeTruthy();
    expect(screen.getByText('model-c')).toBeTruthy();
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Download' })).toBeTruthy();
  });

  it('wires the card actions to the handlers', () => {
    const props = makeProps();
    render(<ModelManagementSection {...props} />);

    fireEvent.click(screen.getByRole('button', { name: 'Activate' }));
    expect(props.handleModelSwitch).toHaveBeenCalledWith('org/model-b');

    fireEvent.click(screen.getByRole('button', { name: /Eject/ }));
    expect(props.handleUnloadModel).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(props.setPendingModel).toHaveBeenCalledWith('org/model-c');
    expect(props.handleDownloadModel).toHaveBeenCalledWith('org/model-c');
  });

  it('shows the delete confirmation only on the selected card', () => {
    render(<ModelManagementSection {...makeProps({ showConfirmDeleteModel: 'org/model-b' })} />);
    expect(screen.getAllByRole('button', { name: 'Del' })).toHaveLength(1);
  });
});
