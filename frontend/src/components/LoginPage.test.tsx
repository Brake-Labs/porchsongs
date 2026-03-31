import { screen, fireEvent } from '@testing-library/react';
import { renderWithRouter } from '@/test/test-utils';
import LoginPage from '@/components/LoginPage';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({
    authConfig: {
      method: 'oauth_google',
      require_invite_code: true,
      magic_link_enabled: true,
    },
    authState: 'login',
  }),
}));

describe('LoginPage -- auth error from OAuth callback', () => {
  afterEach(() => {
    window.location.hash = '';
  });

  it('displays generic auth error from URL hash (prevents phishing)', () => {
    window.location.hash = '#auth_error=Attacker%20controlled%20message';
    renderWithRouter(<LoginPage />);
    // Should show generic message, NOT the attacker-controlled hash content
    expect(screen.getByText('Sign-in failed. Please try again.')).toBeInTheDocument();
  });

  it('clears the hash after consuming the error', () => {
    window.location.hash = '#auth_error=Some%20error';
    renderWithRouter(<LoginPage />);
    expect(window.location.hash).toBe('');
  });

  it('does not show error banner when no auth_error in hash', () => {
    window.location.hash = '';
    renderWithRouter(<LoginPage />);
    expect(screen.queryByText(/error/i)).not.toBeInTheDocument();
  });
});

describe('LoginPage -- sign-in view (default)', () => {
  it('renders the sign-in form', () => {
    renderWithRouter(<LoginPage />);
    expect(screen.getByText('porchsongs')).toBeInTheDocument();
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign in with Google' })).toBeInTheDocument();
  });

  it('does not show terms checkbox or invite code input', () => {
    renderWithRouter(<LoginPage />);
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
  });

  it('sign-in button is enabled by default (no terms required)', () => {
    renderWithRouter(<LoginPage />);
    const button = screen.getByRole('button', { name: 'Sign in with Google' });
    expect(button).toBeEnabled();
  });

  it('shows toggle to switch to sign-up view', () => {
    renderWithRouter(<LoginPage />);
    expect(screen.getByText("Don't have an account? Sign up")).toBeInTheDocument();
  });

  it('shows magic link option when enabled', () => {
    renderWithRouter(<LoginPage />);
    expect(screen.getByText('Sign in with email link')).toBeInTheDocument();
  });
});

describe('LoginPage -- sign-up view', () => {
  function switchToSignUp() {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText("Don't have an account? Sign up"));
  }

  it('shows terms checkbox and invite code input when toggled', () => {
    switchToSignUp();
    expect(screen.getByText('Create your account')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Accept Terms and Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
  });

  it('disables sign-up button until terms accepted and invite code entered', () => {
    switchToSignUp();
    const button = screen.getByRole('button', { name: 'Sign up with Google' });
    expect(button).toBeDisabled();

    // Accept terms but no invite code
    fireEvent.click(screen.getByRole('checkbox', { name: 'Accept Terms and Privacy Policy' }));
    expect(button).toBeDisabled();

    // Enter invite code
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'PORCH-ABC123' } });
    expect(button).toBeEnabled();
  });

  it('shows links to Terms and Privacy Policy', () => {
    switchToSignUp();
    expect(screen.getByText('Terms of Service')).toHaveAttribute('href', '/terms');
    expect(screen.getByText('Privacy Policy')).toHaveAttribute('href', '/privacy');
  });

  it('can toggle back to sign-in view', () => {
    switchToSignUp();
    fireEvent.click(screen.getByText('Already have an account? Sign in'));
    expect(screen.getByText('Sign in to continue')).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('resets state when toggling between views', () => {
    renderWithRouter(<LoginPage />);

    // Switch to sign-up, accept terms, enter code
    fireEvent.click(screen.getByText("Don't have an account? Sign up"));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Accept Terms and Privacy Policy' }));
    fireEvent.change(screen.getByLabelText('Invite code'), { target: { value: 'PORCH-ABC123' } });

    // Switch back to sign-in and back to sign-up -- state should be reset
    fireEvent.click(screen.getByText('Already have an account? Sign in'));
    fireEvent.click(screen.getByText("Don't have an account? Sign up"));

    expect(screen.getByRole('checkbox', { name: 'Accept Terms and Privacy Policy' })).not.toBeChecked();
    expect(screen.getByLabelText('Invite code')).toHaveValue('');
  });

});

describe('LoginPage -- magic link flow', () => {
  it('shows email input when magic link is clicked', () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText('Sign in with email link'));
    expect(screen.getByLabelText('Email address')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeInTheDocument();
  });

  it('disables send button when email is empty', () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText('Sign in with email link'));
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeDisabled();
  });

  it('enables send button when email is entered', () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText('Sign in with email link'));
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.com' } });
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeEnabled();
  });

  it('does not show invite code field when entering from sign-in view', () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText('Sign in with email link'));
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
  });

  it('shows invite code field when entering from sign-up view', () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText("Don't have an account? Sign up"));
    fireEvent.click(screen.getByText('Sign up with email link'));
    expect(screen.getByLabelText('Invite code')).toBeInTheDocument();
  });

  it('shows terms and privacy policy notice', () => {
    renderWithRouter(<LoginPage />);
    fireEvent.click(screen.getByText('Sign in with email link'));
    expect(screen.getByText('Terms')).toHaveAttribute('href', '/terms');
    expect(screen.getByText('Privacy Policy')).toHaveAttribute('href', '/privacy');
  });
});

describe('LoginPage -- magic link without invite code required', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not show invite code field and enables send with email only', async () => {
    vi.doMock('@/contexts/AuthContext', () => ({
      useAuth: () => ({
        authConfig: {
          method: 'oauth_google',
          require_invite_code: false,
          magic_link_enabled: true,
        },
        authState: 'login',
      }),
    }));
    const { default: LP } = await import('@/components/LoginPage');
    const { renderWithRouter: rwr } = await import('@/test/test-utils');

    rwr(<LP />);
    fireEvent.click(screen.getByText('Sign in with email link'));
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'test@example.com' } });
    expect(screen.getByRole('button', { name: 'Send sign-in link' })).toBeEnabled();
  });
});

describe('LoginPage -- magic link disabled', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not show magic link option when disabled', async () => {
    vi.doMock('@/contexts/AuthContext', () => ({
      useAuth: () => ({
        authConfig: {
          method: 'oauth_google',
          require_invite_code: false,
          magic_link_enabled: false,
        },
        authState: 'login',
      }),
    }));
    const { default: LP } = await import('@/components/LoginPage');
    const { renderWithRouter: rwr } = await import('@/test/test-utils');

    rwr(<LP />);
    expect(screen.queryByText('Sign in with email link')).not.toBeInTheDocument();
  });
});

describe('LoginPage -- sign-up without invite code required', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('does not show invite code input when not required', async () => {
    vi.doMock('@/contexts/AuthContext', () => ({
      useAuth: () => ({
        authConfig: {
          method: 'oauth_google',
          require_invite_code: false,
          magic_link_enabled: true,
        },
        authState: 'login',
      }),
    }));
    const { default: LP } = await import('@/components/LoginPage');
    const { renderWithRouter: rwr } = await import('@/test/test-utils');

    rwr(<LP />);
    fireEvent.click(screen.getByText("Don't have an account? Sign up"));
    expect(screen.queryByLabelText('Invite code')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Accept Terms and Privacy Policy' })).toBeInTheDocument();
  });
});
