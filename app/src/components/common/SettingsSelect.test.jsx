import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SettingsSelect } from './SettingsSelect';

const options = [
  { value: 'a', label: 'Alpha' },
  { value: 'b', label: 'Beta' },
  { value: 'c', label: 'Gamma' },
];

describe('SettingsSelect', () => {
  afterEach(cleanup);

  it('shows the selected label and keeps the list closed', () => {
    render(<SettingsSelect value="b" onChange={() => {}} options={options} />);
    expect(screen.getByText('Beta')).toBeTruthy();
    expect(screen.queryByText('Alpha')).toBeNull();
  });

  it('matches the value as a string and falls back to the first option', () => {
    const numeric = [{ value: 1, label: 'One' }, { value: 2, label: 'Two' }];
    const { unmount } = render(<SettingsSelect value="2" onChange={() => {}} options={numeric} />);
    expect(screen.getByText('Two')).toBeTruthy();
    unmount();
    render(<SettingsSelect value="nope" onChange={() => {}} options={numeric} />);
    expect(screen.getByText('One')).toBeTruthy();
  });

  it('opens on click, calls onChange(value) for a chosen option and closes', () => {
    const onChange = vi.fn();
    render(<SettingsSelect value="a" onChange={onChange} options={options} />);

    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Gamma')).toBeTruthy();

    fireEvent.click(screen.getByText('Gamma'));
    expect(onChange).toHaveBeenCalledWith('c');
    expect(screen.queryByText('Gamma')).toBeNull();
  });

  it('closes on a mousedown outside', () => {
    render(
      <div>
        <span data-testid="outside">outside</span>
        <SettingsSelect value="a" onChange={() => {}} options={options} />
      </div>
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Beta')).toBeTruthy();

    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(screen.queryByText('Beta')).toBeNull();
  });

  it('stays open on a mousedown inside', () => {
    render(<SettingsSelect value="a" onChange={() => {}} options={options} />);
    fireEvent.click(screen.getByRole('button'));
    fireEvent.mouseDown(screen.getByText('Beta'));
    expect(screen.getByText('Beta')).toBeTruthy();
  });

  it('does not open when disabled', () => {
    render(<SettingsSelect value="a" onChange={() => {}} options={options} disabled />);
    const button = screen.getByRole('button');
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(screen.queryByText('Beta')).toBeNull();
  });
});
