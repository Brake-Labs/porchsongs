import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/test-utils';
import Header from '@/components/Header';

/**
 * Stands in for the premium FeedbackButton.
 *
 * Only FeedbackButton is overridden; everything else the barrel exports is passed
 * through, so this cannot mask a real seam break. The OSS stub returns null by
 * design, which means Header's `user &&` gate has no observable effect in this
 * repo unless the member renders something.
 */
vi.mock('@/extensions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/extensions')>()),
  FeedbackButton: () => <button data-testid="feedback-stub">Feedback</button>,
}));

describe('Header', () => {
  const defaults = {
    user: null,
    authRequired: false,
    onLogout: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the app name and tagline', () => {
    renderWithRouter(<Header {...defaults} />);
    expect(screen.getByText('porchsongs')).toBeInTheDocument();
    expect(screen.getByText('Your chord charts, ready to play')).toBeInTheDocument();
  });

  it('does not carry the pre-rebrand rewriting pitch', () => {
    // Mirrors the guard already in premium's HomePage.test.tsx. That test caught
    // the marketing copy; this line outlived it in the app chrome, where it
    // contradicted the home page for the whole rebrand.
    renderWithRouter(<Header {...defaults} />);
    expect(screen.queryByText('Make every song yours')).not.toBeInTheDocument();
  });

  it('hides title text on mobile via hidden sm:inline class', () => {
    renderWithRouter(<Header {...defaults} />);
    const title = screen.getByText('porchsongs');
    expect(title.className).toContain('hidden');
    expect(title.className).toContain('sm:inline');
  });

  it('links logo to /app/library in OSS mode', () => {
    renderWithRouter(<Header {...defaults} />);
    const link = screen.getByText('porchsongs').closest('a');
    expect(link).toHaveAttribute('href', '/app/library');
  });

  it('links logo to / in premium mode', () => {
    renderWithRouter(<Header {...defaults} isPremium />);
    const link = screen.getByText('porchsongs').closest('a');
    expect(link).toHaveAttribute('href', '/');
  });

  it('shows logout button when auth is required', () => {
    renderWithRouter(<Header {...defaults} authRequired={true} />);
    expect(screen.getByText('Log out')).toBeInTheDocument();
  });

  it('hides logout button when auth is not required', () => {
    renderWithRouter(<Header {...defaults} authRequired={false} />);
    expect(screen.queryByText('Log out')).not.toBeInTheDocument();
  });

  it('calls onLogout when logout button is clicked', async () => {
    const user = userEvent.setup();
    renderWithRouter(<Header {...defaults} authRequired={true} />);
    await user.click(screen.getByText('Log out'));
    expect(defaults.onLogout).toHaveBeenCalledOnce();
  });

  it('shows user name when user is provided', () => {
    renderWithRouter(<Header {...defaults} user={{ id: 1, email: 'test@test.com', name: 'Test User', role: 'user', is_active: true, created_at: '' }} />);
    expect(screen.getByText('Test User')).toBeInTheDocument();
  });

  describe('feedback slot', () => {
    const signedIn = {
      id: 1,
      email: 'test@test.com',
      name: 'Test User',
      role: 'user',
      is_active: true,
      created_at: '',
    };

    it('renders the premium feedback control only when signed in', () => {
      // The OSS stub renders null, so the seam member is mocked to a sentinel.
      // Without this the gate below is untestable in OSS: both branches render
      // nothing and the assertion would pass even with the gate deleted.
      renderWithRouter(<Header {...defaults} user={signedIn} />);
      expect(screen.getByTestId('feedback-stub')).toBeInTheDocument();
    });

    it('omits the feedback control when there is no user', () => {
      renderWithRouter(<Header {...defaults} user={null} />);
      expect(screen.queryByTestId('feedback-stub')).not.toBeInTheDocument();
    });
  });
});
