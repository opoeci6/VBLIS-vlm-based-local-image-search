import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { IndexingErrorsAlert } from './IndexingErrorsAlert';

describe('IndexingErrorsAlert', () => {
  afterEach(cleanup);

  it('is hidden when the alert flag is off', () => {
    const { container } = render(
      <IndexingErrorsAlert showErrorAlert={false} setShowErrorAlert={vi.fn()} status={{ failed_files: ['/a.jpg'] }} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('is hidden without failed files', () => {
    const { container, rerender } = render(
      <IndexingErrorsAlert showErrorAlert setShowErrorAlert={vi.fn()} status={{ failed_files: [] }} />
    );
    expect(container.firstChild).toBeNull();
    rerender(<IndexingErrorsAlert showErrorAlert setShowErrorAlert={vi.fn()} status={{}} />);
    expect(container.firstChild).toBeNull();
  });

  it('lists the failed files with a pluralised count', () => {
    render(
      <IndexingErrorsAlert showErrorAlert setShowErrorAlert={vi.fn()} status={{ failed_files: ['/a.jpg', '/b.jpg'] }} />
    );
    expect(screen.getByText('Indexing Errors Encountered')).toBeTruthy();
    expect(screen.getByText(/The following 2 files could not be successfully processed:/)).toBeTruthy();
    expect(screen.getByText('/a.jpg')).toBeTruthy();
    expect(screen.getByText('/b.jpg')).toBeTruthy();
  });

  it('uses the singular for one file', () => {
    render(<IndexingErrorsAlert showErrorAlert setShowErrorAlert={vi.fn()} status={{ failed_files: ['/a.jpg'] }} />);
    expect(screen.getByText(/The following 1 file could not be successfully processed:/)).toBeTruthy();
  });

  it('dismisses via setShowErrorAlert(false)', () => {
    const setShowErrorAlert = vi.fn();
    render(<IndexingErrorsAlert showErrorAlert setShowErrorAlert={setShowErrorAlert} status={{ failed_files: ['/a.jpg'] }} />);
    fireEvent.click(screen.getByRole('button'));
    expect(setShowErrorAlert).toHaveBeenCalledWith(false);
  });
});
