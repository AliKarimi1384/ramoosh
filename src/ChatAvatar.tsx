import './chat-avatar.css';

type ChatAvatarProps = { role: 'user' | 'assistant' };

export function ChatAvatar({ role }: ChatAvatarProps) {
  return (
    <span className="avatar" aria-hidden="true">
      {role === 'assistant' ? (
        <svg viewBox="0 0 24 24" fill="none">
          <path d="M12 3v2.5M9.5 3h5" />
          <rect x="4.5" y="6" width="15" height="13" rx="4" />
          <path d="M4.5 11H3m18 0h-1.5M9 14.5c.8.8 1.8 1.2 3 1.2s2.2-.4 3-1.2" />
          <circle cx="9" cy="11" r=".8" fill="currentColor" stroke="none" />
          <circle cx="15" cy="11" r=".8" fill="currentColor" stroke="none" />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5.5 19c.3-3.1 2.7-5 6.5-5s6.2 1.9 6.5 5" />
        </svg>
      )}
    </span>
  );
}
