import { useFirebaseEmulators } from './firebase';

export const localAccountAccess = import.meta.env.MODE === 'test'
  && import.meta.env.VITE_LOCAL_QUICK_SIGN_IN === 'true'
  && useFirebaseEmulators
  && ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)
  ? {
      accounts: [
        { label: 'Continue as Admin', email: 'organizer@wmsu.edu.ph' },
        { label: 'Continue as User', email: 'student@wmsu.edu.ph' },
      ],
      password: 'ArenaHub-QA-Only-27!',
    }
  : null;
