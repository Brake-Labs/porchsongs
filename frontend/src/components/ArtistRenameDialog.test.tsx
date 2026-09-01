import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ArtistRenameDialog from '@/components/ArtistRenameDialog';

/**
 * The dialog's whole job beyond collecting a string is spotting a merge before
 * it happens. Renaming onto a name already in use folds two artists into one,
 * and renaming back does not separate them again, so the warning is the feature.
 */
function setup(typed?: string) {
  const onConfirm = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <ArtistRenameDialog
      open
      onOpenChange={onOpenChange}
      artist={{ name: 'Neil Young', count: 12 }}
      others={[
        { name: 'Neil Young & Crazy Horse', count: 4 },
        { name: 'Bill Monroe', count: 3 },
      ]}
      onConfirm={onConfirm}
    />,
  );
  return { onConfirm, onOpenChange, typed };
}

it('says how many charts the rename would touch', () => {
  setup();
  expect(screen.getByText(/all 12 charts/)).toBeInTheDocument();
});

it('renames without a warning when the name is not in use', async () => {
  const user = userEvent.setup();
  const { onConfirm } = setup();

  const input = screen.getByLabelText('Artist name');
  await user.clear(input);
  await user.type(input, 'Shakey');

  expect(screen.queryByTestId('artist-merge-warning')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Rename' }));
  expect(onConfirm).toHaveBeenCalledWith('Neil Young', 'Shakey');
});

it('warns before merging, with both counts and the total', async () => {
  const user = userEvent.setup();
  setup();

  const input = screen.getByLabelText('Artist name');
  await user.clear(input);
  await user.type(input, 'Neil Young & Crazy Horse');

  const warning = screen.getByTestId('artist-merge-warning');
  expect(warning).toHaveTextContent('already has 4 charts');
  expect(warning).toHaveTextContent('16 in total');
  // The button says what the press will do, not what the dialog is called.
  expect(screen.getByRole('button', { name: 'Merge' })).toBeInTheDocument();
});

it('spots a merge that differs only by case or spacing', async () => {
  const user = userEvent.setup();
  setup();

  const input = screen.getByLabelText('Artist name');
  await user.clear(input);
  await user.type(input, 'bill   monroe');

  // The library groups its cards by exactly this folding, so two spellings are
  // one card already and renaming onto either is the same merge.
  expect(screen.getByTestId('artist-merge-warning')).toHaveTextContent('already has 3 charts');
});

it('does not call the rename a merge with itself', async () => {
  const user = userEvent.setup();
  setup();

  const input = screen.getByLabelText('Artist name');
  await user.clear(input);
  await user.type(input, 'NEIL YOUNG');

  // Recasing your own artist is a rename, not a merge, and warning about it
  // would teach people to click through the warning that matters.
  expect(screen.queryByTestId('artist-merge-warning')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Rename' })).toBeEnabled();
});

it('refuses an empty name and an unchanged one', async () => {
  const user = userEvent.setup();
  setup();
  const input = screen.getByLabelText('Artist name');

  expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();

  await user.clear(input);
  expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();

  await user.type(input, '   ');
  expect(screen.getByRole('button', { name: 'Rename' })).toBeDisabled();
});

it('trims the name it hands back', async () => {
  const user = userEvent.setup();
  const { onConfirm } = setup();

  const input = screen.getByLabelText('Artist name');
  await user.clear(input);
  await user.type(input, '  Shakey  ');
  await user.click(screen.getByRole('button', { name: 'Rename' }));

  expect(onConfirm).toHaveBeenCalledWith('Neil Young', 'Shakey');
});

it('submits on Enter, since the dialog is one field', async () => {
  const user = userEvent.setup();
  const { onConfirm } = setup();

  const input = screen.getByLabelText('Artist name');
  await user.clear(input);
  await user.type(input, 'Shakey{Enter}');

  expect(onConfirm).toHaveBeenCalledWith('Neil Young', 'Shakey');
});
