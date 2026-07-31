import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/test-utils';
import Header from '@/components/Header';

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
    expect(screen.getByText('Make every song yours')).toBeInTheDocument();
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
});
