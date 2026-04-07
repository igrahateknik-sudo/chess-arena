import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { User, ThemeMode, BoardTheme, ServerNotification } from '@/types';
import { disconnectSocket } from '@/lib/socket';

interface AppStore {
  // Auth
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (user: User, token: string) => void;
  updateUser: (updates: Partial<User>) => void;
  logout: () => void;

  // Theme
  theme: ThemeMode;
  toggleTheme: () => void;

  // Board settings
  boardTheme: BoardTheme;
  setBoardTheme: (theme: BoardTheme) => void;
  showLegalMoves: boolean;
  toggleLegalMoves: () => void;
  showCoordinates: boolean;
  toggleCoordinates: () => void;
  soundEnabled: boolean;
  toggleSound: () => void;
  animationsEnabled: boolean;
  toggleAnimations: () => void;

  // UI
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;

  // Toast Notifications (in-app)
  notifications: ToastNotification[];
  addNotification: (notification: Omit<ToastNotification, 'id'>) => void;
  removeNotification: (id: string) => void;

  // Real-time: server notifications dari DB
  serverNotifications: ServerNotification[];
  setServerNotifications: (notifs: ServerNotification[]) => void;
  markServerNotificationsRead: () => void;

  // Real-time: jumlah pemain online & game aktif
  onlineUsers: number;
  activeGames: number;
  setLobbyStats: (count: number, activeGames: number) => void;
}

interface ToastNotification {
  id: string;
  type: 'success' | 'error' | 'info' | 'warning';
  title: string;
  message: string;
}

export const useAppStore = create<AppStore>()(
  persist(
    (set) => ({
      user: null,
      token: null,
      isAuthenticated: false,
      login: (user, token) => set({ user, token, isAuthenticated: true }),
      updateUser: (updates) => set((state) => ({
        user: state.user ? { ...state.user, ...updates } : null,
      })),
      logout: () => {
        disconnectSocket();
        set({ user: null, token: null, isAuthenticated: false, serverNotifications: [], onlineUsers: 0, activeGames: 0 });
      },

      theme: 'dark',
      toggleTheme: () => set((state) => ({ theme: state.theme === 'dark' ? 'light' : 'dark' })),

      boardTheme: 'classic',
      setBoardTheme: (boardTheme) => set({ boardTheme }),
      showLegalMoves: true,
      toggleLegalMoves: () => set((state) => ({ showLegalMoves: !state.showLegalMoves })),
      showCoordinates: true,
      toggleCoordinates: () => set((state) => ({ showCoordinates: !state.showCoordinates })),
      soundEnabled: true,
      toggleSound: () => set((state) => ({ soundEnabled: !state.soundEnabled })),
      animationsEnabled: true,
      toggleAnimations: () => set((state) => ({ animationsEnabled: !state.animationsEnabled })),

      sidebarOpen: true,
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),

      notifications: [],
      addNotification: (notification) =>
        set((state) => ({
          notifications: [...state.notifications, { ...notification, id: crypto.randomUUID() }],
        })),
      removeNotification: (id) =>
        set((state) => ({
          notifications: state.notifications.filter((n) => n.id !== id),
        })),

      serverNotifications: [],
      setServerNotifications: (notifs) => set({ serverNotifications: notifs }),
      markServerNotificationsRead: () =>
        set((state) => ({
          serverNotifications: state.serverNotifications.map((n) => ({ ...n, read: true })),
        })),

      onlineUsers: 0,
      activeGames: 0,
      setLobbyStats: (count, activeGames) => set({ onlineUsers: count, activeGames }),
    }),
    {
      name: 'chess-arena-store',
      partialize: (state) => ({
        theme: state.theme,
        boardTheme: state.boardTheme,
        showLegalMoves: state.showLegalMoves,
        showCoordinates: state.showCoordinates,
        soundEnabled: state.soundEnabled,
        animationsEnabled: state.animationsEnabled,
      }),
    }
  )
);
