import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001';
const socket = io(API_URL);

const UI = {
  Gabe: {
    welcomeTitle: 'Добро пожаловать в чат',
    selectPrompt: 'Кто ты?',
    pollyLang: '🇷🇺 Russian',
    gabeLang: '🇺🇸 English',
    viewingAs: '🇺🇸 Viewing in English',
    switchUser: 'Switch User',
    noMessages: 'No messages yet. Say hello!',
    inputPlaceholder: 'Type a message...',
    send: 'Send',
    chatTitle: 'Polly & Gabe Chat',
  },
  Polly: {
    welcomeTitle: 'Добро пожаловать в чат',
    selectPrompt: 'Кто вы?',
    pollyLang: '🇷🇺 Русский',
    gabeLang: '🇺🇸 Английский',
    viewingAs: '🇷🇺 Просмотр на русском',
    switchUser: 'Сменить пользователя',
    noMessages: 'Сообщений пока нет. Скажите привет!',
    inputPlaceholder: 'Написать сообщение...',
    send: 'Отправить',
    chatTitle: 'Чат Полли и Гейба',
  },
};

// Default UI strings shown on the selection screen before a user is chosen
const UI_DEFAULT = UI.Gabe;

export default function App() {
  const cachedPin = localStorage.getItem('pinVerifiedAt');
  const pinStillValid = cachedPin && Date.now() - Number(cachedPin) < 24 * 60 * 60 * 1000;
  const [pinVerified, setPinVerified] = useState(!!pinStillValid);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState(false);
  const [user, setUser] = useState(null); // 'Polly' | 'Gabe'
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [error, setError] = useState(null);
  const [typingUser, setTypingUser] = useState(null);
  const [hoveredMessageId, setHoveredMessageId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fontSize, setFontSize] = useState(15);
  const [profileImages, setProfileImages] = useState({ Polly: null, Gabe: null });
  const [pendingImage, setPendingImage] = useState(null); // { file, preview }
  const [replyingTo, setReplyingTo] = useState(null); // message object
  const messagesEndRef = useRef(null);
  const typingTimeoutRef = useRef(null);
  const imageInputRef = useRef(null);
  const profileInputRef = useRef(null);
  const textInputRef = useRef(null);


  const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🔥'];

  const t = user ? UI[user] : UI_DEFAULT;

  // Load existing messages on mount, retry until backend is ready
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch(`${API_URL}/api/messages`)
        .then((res) => {
          if (!res.ok) throw new Error();
          return res.json();
        })
        .then((data) => {
          if (!cancelled) {
            setMessages(data);
            setError(null);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setError('Connecting to server...');
            setTimeout(load, 2000);
          }
        });
    };
    load();
    return () => { cancelled = true; };
  }, []);

  // Load profile images
  useEffect(() => {
    ['Polly', 'Gabe'].forEach((name) => {
      fetch(`${API_URL}/api/profile/${name}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.imageData) {
            setProfileImages((prev) => ({ ...prev, [name]: data.imageData }));
          }
        })
        .catch(() => {});
    });
  }, []);

  // Listen for new messages via socket
  useEffect(() => {
    socket.on('newMessage', (message) => {
      setMessages((prev) => [...prev, message]);
    });

    socket.on('error', ({ message }) => {
      setError(message);
    });

    socket.on('userTyping', ({ sender }) => {
      setTypingUser(sender);
    });

    socket.on('userStopTyping', () => {
      setTypingUser(null);
    });

    socket.on('messageReacted', ({ messageId, reactions }) => {
      setMessages((prev) =>
        prev.map((m) => (m._id === messageId ? { ...m, reactions } : m))
      );
    });

    socket.on('messageDeleted', ({ messageId }) => {
      setMessages((prev) => prev.filter((m) => m._id !== messageId));
    });

    return () => {
      socket.off('newMessage');
      socket.off('error');
      socket.off('userTyping');
      socket.off('userStopTyping');
      socket.off('messageReacted');
      socket.off('messageDeleted');
    };
  }, []);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const submitPin = async (e) => {
    e.preventDefault();
    try {
      const res = await fetch(`${API_URL}/api/verify-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pinInput }),
      });
      if (res.ok) {
        localStorage.setItem('pinVerifiedAt', Date.now().toString());
        setPinVerified(true);
        setPinError(false);
      } else {
        setPinError(true);
        setPinInput('');
      }
    } catch {
      setPinError(true);
    }
  };

  const handleInputChange = (e) => {
    setInputText(e.target.value);

    if (user) {
      socket.emit('typing', { sender: user });
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = setTimeout(() => {
        socket.emit('stopTyping');
      }, 1500);
    }
  };

  const fileToBase64 = (file) => new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(file);
  });

  const uploadProfileImage = async (file, userName) => {
    try {
      const imageData = await fileToBase64(file);
      const res = await fetch(`${API_URL}/api/profile/${userName}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageData }),
      });
      const data = await res.json();
      if (data.imageData) {
        setProfileImages((prev) => ({ ...prev, [userName]: data.imageData }));
      }
    } catch {}
  };

  const handleImageAttach = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const preview = URL.createObjectURL(file);
    setPendingImage({ file, preview });
    e.target.value = '';
  };

  const sendMessage = async (e) => {
    e.preventDefault();
    if ((!inputText.trim() && !pendingImage) || !user) return;

    clearTimeout(typingTimeoutRef.current);
    socket.emit('stopTyping');

    let imageData = null;
    if (pendingImage) {
      imageData = await fileToBase64(pendingImage.file);
      URL.revokeObjectURL(pendingImage.preview);
      setPendingImage(null);
    }

    socket.emit('sendMessage', { sender: user, text: inputText.trim(), imageData, replyTo: replyingTo?._id || null });
    setInputText('');
    setReplyingTo(null);
    setError(null);
  };

  // Return the display text based on the current user's language
  const getDisplayText = (msg) => {
    return user === 'Polly' ? msg.russianText : msg.englishText;
  };

  if (!pinVerified) {
    return (
      <div style={styles.selectScreen}>
        <div style={styles.selectCard}>
          <h1 style={styles.title}>Enter PIN</h1>
          <p style={styles.subtitle}>Enter the 4-digit PIN to continue</p>
          <form onSubmit={submitPin} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16 }}>
            <input
              type="password"
              inputMode="numeric"
              maxLength={4}
              value={pinInput}
              onChange={(e) => { setPinInput(e.target.value.replace(/\D/g, '')); setPinError(false); }}
              placeholder="••••"
              style={{
                ...styles.pinInput,
                borderColor: pinError ? '#ef4444' : '#2a2a36',
              }}
              autoFocus
            />
            {pinError && <p style={styles.pinError}>Incorrect PIN. Try again.</p>}
            <button type="submit" style={styles.pinBtn} disabled={pinInput.length !== 4}>
              Unlock
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={styles.selectScreen}>
        <style>{`
          .profile-avatar:hover .profile-overlay { opacity: 1 !important; }
        `}</style>
        <input
          type="file"
          accept="image/*"
          ref={profileInputRef}
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files[0];
            const targetUser = profileInputRef.current.dataset.user;
            if (file && targetUser) uploadProfileImage(file, targetUser);
            e.target.value = '';
          }}
        />
        <div style={styles.selectCard}>
          <h1 style={styles.title}>{UI_DEFAULT.welcomeTitle}</h1>
          <p style={styles.subtitle}>{UI_DEFAULT.selectPrompt}</p>
          <div style={styles.buttonRow}>
            {['Polly', 'Gabe'].map((name) => (
              <div key={name} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                <div
                  className="profile-avatar"
                  style={{
                    ...styles.profileAvatarLarge,
                    ...(name === 'Polly' ? styles.pollyAvatarBorder : styles.gabeAvatarBorder),
                  }}
                  onClick={(e) => { e.stopPropagation(); profileInputRef.current.dataset.user = name; profileInputRef.current.click(); }}
                  title="Click to change profile picture"
                >
                  {profileImages[name] ? (
                    <img src={profileImages[name]} alt={name} style={styles.profileImg} />
                  ) : (
                    <span style={styles.profileInitial}>{name[0]}</span>
                  )}
                  <div className="profile-overlay" style={styles.profileOverlay}>
                    <span style={{ fontSize: 18 }}>📷</span>
                  </div>
                </div>
                <button
                  style={{
                    ...styles.userButton,
                    ...(name === 'Polly' ? styles.pollyButton : styles.gabeButton),
                  }}
                  onClick={() => setUser(name)}
                >
                  {name}
                  <span style={styles.langTag}>
                    {name === 'Polly' ? UI_DEFAULT.pollyLang : UI_DEFAULT.gabeLang}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.app}>
      <style>{`
        @keyframes typingBounce {
          0%, 60%, 100% { transform: translateY(0); }
          30% { transform: translateY(-6px); }
        }
        .typing-dot {
          width: 8px; height: 8px; border-radius: 50%;
          background: #666; display: inline-block;
          animation: typingBounce 1s infinite;
        }
        .typing-dot:nth-child(2) { animation-delay: 200ms; }
        .typing-dot:nth-child(3) { animation-delay: 400ms; }
      `}</style>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <span style={styles.headerTitle}>{t.chatTitle}</span>
          <span style={styles.headerSub}>{t.viewingAs}</span>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', position: 'relative' }}>
          <button style={styles.switchBtn} onClick={() => { setSettingsOpen((o) => !o); }}>
            ⚙ Settings
          </button>
          <button style={styles.switchBtn} onClick={() => setUser(null)}>
            {t.switchUser}
          </button>
          {settingsOpen && (
            <div style={styles.settingsDropdown}>
              <p style={styles.settingsLabel}>Font Size — {fontSize}pt</p>
              <input
                type="range"
                min={1}
                max={100}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                style={{ width: '100%', cursor: 'pointer' }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Messages */}
      <div style={styles.messagesContainer}>
        {messages.length === 0 && (
          <p style={styles.emptyState}>{t.noMessages}</p>
        )}
        {messages.map((msg) => {
          const isOwn = msg.sender === user;
          const reactions = msg.reactions && typeof msg.reactions === 'object' ? msg.reactions : {};
          const reactionEntries = Object.entries(reactions).filter(([, users]) => users.length > 0);
          return (
            <div
              key={msg._id}
              style={{
                ...styles.messageWrapper,
                justifyContent: isOwn ? 'flex-end' : 'flex-start',
              }}
              onMouseEnter={() => setHoveredMessageId(msg._id)}
              onMouseLeave={() => setHoveredMessageId(null)}
            >
              {/* Hover actions — emoji picker + reply */}
              {hoveredMessageId === msg._id && user && (
                <div style={{
                  ...styles.hoverActions,
                  order: isOwn ? -1 : 1,
                  marginRight: isOwn ? 8 : 0,
                  marginLeft: isOwn ? 0 : 8,
                }}>
                  <button
                    style={styles.replyBtn}
                    onClick={() => { setReplyingTo(msg); setTimeout(() => textInputRef.current?.focus(), 0); }}
                    title="Reply"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 17 4 12 9 7" />
                      <path d="M20 18v-2a4 4 0 0 0-4-4H4" />
                    </svg>
                  </button>
                  <button
                    style={styles.deleteBtn}
                    onClick={() => { if (window.confirm('Delete this message?')) socket.emit('deleteMessage', { messageId: msg._id }); }}
                    title="Delete"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                      <path d="M10 11v6" />
                      <path d="M14 11v6" />
                      <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                    </svg>
                  </button>
                  <div style={styles.emojiPicker}>
                    {EMOJIS.map((emoji) => (
                      <button
                        key={emoji}
                        style={styles.emojiBtn}
                        onClick={() => socket.emit('reactToMessage', { messageId: msg._id, emoji, sender: user })}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {/* Avatar for other user's messages */}
              {!isOwn && (
                <div style={styles.messageAvatar}>
                  {profileImages[msg.sender] ? (
                    <img src={profileImages[msg.sender]} alt={msg.sender} style={styles.messageAvatarImg} />
                  ) : (
                    <span style={styles.messageAvatarInitial}>{msg.sender[0]}</span>
                  )}
                </div>
              )}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: isOwn ? 'flex-end' : 'flex-start' }}>
                <div
                  style={{
                    ...styles.messageBubble,
                    ...(isOwn ? styles.ownBubble : styles.otherBubble),
                  }}
                >
                  <span style={styles.senderName}>{msg.sender}</span>
                  {msg.replyTo && (
                    <div style={styles.replyQuote}>
                      <span style={styles.replyQuoteSender}>{msg.replyTo.sender}</span>
                      <span style={styles.replyQuoteText}>
                        {msg.replyTo.imageData && '📷 '}
                        {getDisplayText(msg.replyTo) || (msg.replyTo.imageData ? 'Image' : '')}
                      </span>
                    </div>
                  )}
                  {msg.imageData && (
                    <img
                      src={msg.imageData}
                      alt="attachment"
                      style={styles.messageImage}
                      onClick={() => window.open(msg.imageData, '_blank')}
                    />
                  )}
                  {getDisplayText(msg) && (
                    <p style={{ ...styles.messageText, fontSize }}>{getDisplayText(msg)}</p>
                  )}
                  <span style={styles.timestamp}>
                    {new Date(msg.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                {reactionEntries.length > 0 && (
                  <div style={styles.reactionsRow}>
                    {reactionEntries.map(([emoji, users]) => (
                      <span
                        key={emoji}
                        style={{
                          ...styles.reactionBadge,
                          ...(users.includes(user) ? styles.reactionBadgeActive : {}),
                        }}
                        onClick={() => user && socket.emit('reactToMessage', { messageId: msg._id, emoji, sender: user })}
                      >
                        {emoji} {users.length}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {typingUser && (
          <div style={{ ...styles.messageWrapper, justifyContent: 'flex-start' }}>
            <div style={{ ...styles.messageBubble, ...styles.otherBubble, padding: '10px 16px' }}>
              <span style={styles.senderName}>{typingUser}</span>
              <div style={styles.typingDots}>
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error */}
      {error && <div style={styles.errorBar}>{error}</div>}

      {/* Reply preview */}
      {replyingTo && (
        <div style={styles.replyPreviewBar}>
          <div style={styles.replyPreviewContent}>
            <span style={styles.replyPreviewSender}>{replyingTo.sender}</span>
            <span style={styles.replyPreviewText}>
              {replyingTo.imageData && '📷 '}
              {getDisplayText(replyingTo) || (replyingTo.imageData ? 'Image' : '')}
            </span>
          </div>
          <button
            style={styles.replyPreviewClose}
            onClick={() => setReplyingTo(null)}
          >
            ✕
          </button>
        </div>
      )}

      {/* Image preview */}
      {pendingImage && (
        <div style={styles.imagePreviewBar}>
          <img src={pendingImage.preview} alt="preview" style={styles.imagePreviewThumb} />
          <button
            style={styles.imagePreviewRemove}
            onClick={() => { URL.revokeObjectURL(pendingImage.preview); setPendingImage(null); }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Input */}
      <form style={styles.inputRow} onSubmit={sendMessage}>
        <input
          type="file"
          accept="image/*"
          ref={imageInputRef}
          style={{ display: 'none' }}
          onChange={handleImageAttach}
        />
        <button
          type="button"
          style={styles.attachBtn}
          onClick={() => imageInputRef.current.click()}
          title="Attach image"
        >
          📎
        </button>
        <input
          ref={textInputRef}
          style={styles.input}
          type="text"
          value={inputText}
          onChange={handleInputChange}
          placeholder={t.inputPlaceholder}
          dir="auto"
        />
        <button type="submit" style={styles.sendButton} disabled={!inputText.trim() && !pendingImage}>
          {t.send}
        </button>
      </form>
    </div>
  );
}

const styles = {
  // User selection screen
  pinInput: {
    width: 120,
    padding: '14px 0',
    textAlign: 'center',
    fontSize: 28,
    letterSpacing: 12,
    borderRadius: 12,
    border: '1px solid #2a2a36',
    background: '#0f0f13',
    color: '#f0f0f5',
    outline: 'none',
  },
  pinError: {
    margin: 0,
    color: '#ef4444',
    fontSize: 13,
  },
  pinBtn: {
    padding: '12px 40px',
    borderRadius: 12,
    border: 'none',
    background: '#1a56db',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
  },
  selectScreen: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: '100vh',
    backgroundColor: '#0f0f13',
    fontFamily: 'system-ui, sans-serif',
  },
  selectCard: {
    background: '#1c1c24',
    borderRadius: 16,
    padding: '48px 40px',
    boxShadow: '0 4px 24px rgba(0,0,0,0.5)',
    textAlign: 'center',
    minWidth: 340,
    border: '1px solid #2a2a36',
  },
  title: {
    fontSize: 28,
    fontWeight: 700,
    margin: '0 0 8px',
    color: '#f0f0f5',
  },
  subtitle: {
    fontSize: 16,
    color: '#888',
    marginBottom: 32,
  },
  buttonRow: {
    display: 'flex',
    gap: 20,
    justifyContent: 'center',
  },
  userButton: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 6,
    padding: '20px 32px',
    borderRadius: 12,
    border: 'none',
    fontSize: 20,
    fontWeight: 700,
    cursor: 'pointer',
    color: '#fff',
  },
  pollyButton: {
    background: 'linear-gradient(135deg, #cc0000, #8b0000)',
    boxShadow: '0 4px 14px rgba(204,0,0,0.35)',
  },
  gabeButton: {
    background: 'linear-gradient(135deg, #1a56db, #0e3a96)',
    boxShadow: '0 4px 14px rgba(26,86,219,0.35)',
  },
  langTag: {
    fontSize: 12,
    fontWeight: 400,
    opacity: 0.9,
  },

  // Chat screen
  app: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: 'system-ui, sans-serif',
    backgroundColor: '#0f0f13',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '16px 24px',
    background: '#1c1c24',
    color: '#f0f0f5',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    borderBottom: '1px solid #2a2a36',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    marginRight: 12,
  },
  headerSub: {
    fontSize: 13,
    opacity: 0.5,
  },
  switchBtn: {
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    color: '#ccc',
    padding: '6px 14px',
    borderRadius: 8,
    cursor: 'pointer',
    fontSize: 13,
  },
  messagesContainer: {
    flex: 1,
    overflowY: 'auto',
    padding: '24px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  emptyState: {
    textAlign: 'center',
    color: '#555',
    marginTop: 60,
    fontSize: 15,
  },
  messageWrapper: {
    display: 'flex',
    width: '100%',
  },
  messageBubble: {
    maxWidth: '65%',
    padding: '10px 14px',
    borderRadius: 16,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  ownBubble: {
    background: '#1a56db',
    color: '#fff',
    borderBottomRightRadius: 4,
  },
  otherBubble: {
    background: '#2a2a36',
    color: '#e8e8f0',
    borderBottomLeftRadius: 4,
    boxShadow: '0 1px 4px rgba(0,0,0,0.3)',
  },
  senderName: {
    fontSize: 11,
    fontWeight: 700,
    opacity: 0.5,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  messageText: {
    margin: 0,
    fontSize: 15,
    lineHeight: 1.4,
  },
  timestamp: {
    fontSize: 10,
    opacity: 0.4,
    alignSelf: 'flex-end',
  },
  errorBar: {
    background: '#3b1414',
    color: '#f87171',
    padding: '10px 24px',
    fontSize: 14,
    textAlign: 'center',
  },
  inputRow: {
    display: 'flex',
    gap: 10,
    padding: '16px',
    background: '#1c1c24',
    borderTop: '1px solid #2a2a36',
  },
  input: {
    flex: 1,
    padding: '12px 16px',
    borderRadius: 24,
    border: '1px solid #2a2a36',
    fontSize: 15,
    outline: 'none',
    background: '#0f0f13',
    color: '#f0f0f5',
  },
  settingsDropdown: {
    position: 'absolute',
    top: 'calc(100% + 10px)',
    right: 0,
    background: '#1c1c24',
    border: '1px solid #2a2a36',
    borderRadius: 12,
    padding: '16px',
    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
    zIndex: 100,
    minWidth: 200,
  },
  settingsLabel: {
    margin: '0 0 10px',
    fontSize: 12,
    fontWeight: 700,
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  hoverActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'center',
  },
  replyBtn: {
    background: '#1c1c24',
    border: '1px solid #2a2a36',
    borderRadius: '50%',
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#888',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    flexShrink: 0,
  },
  deleteBtn: {
    background: '#1c1c24',
    border: '1px solid #2a2a36',
    borderRadius: '50%',
    width: 32,
    height: 32,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    color: '#ef4444',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
    flexShrink: 0,
  },
  emojiPicker: {
    display: 'flex',
    alignItems: 'center',
    background: '#1c1c24',
    border: '1px solid #2a2a36',
    borderRadius: 20,
    padding: '4px 6px',
    gap: 2,
    alignSelf: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
  },
  emojiBtn: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontSize: 18,
    padding: '2px 4px',
    borderRadius: 6,
    lineHeight: 1,
  },
  reactionsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 4,
    paddingLeft: 4,
  },
  reactionBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 3,
    background: '#2a2a36',
    border: '1px solid #3a3a4a',
    borderRadius: 12,
    padding: '2px 8px',
    fontSize: 13,
    cursor: 'pointer',
    color: '#ccc',
  },
  reactionBadgeActive: {
    background: '#1a3a6b',
    border: '1px solid #1a56db',
    color: '#fff',
  },
  typingDots: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    padding: '2px 0',
  },
  sendButton: {
    padding: '12px 24px',
    borderRadius: 24,
    border: 'none',
    background: '#1a56db',
    color: '#fff',
    fontWeight: 700,
    fontSize: 15,
    cursor: 'pointer',
  },

  // Profile avatars on select screen
  profileAvatarLarge: {
    width: 80,
    height: 80,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    position: 'relative',
    background: '#2a2a36',
    border: '3px solid transparent',
  },
  pollyAvatarBorder: {
    borderColor: '#cc0000',
  },
  gabeAvatarBorder: {
    borderColor: '#1a56db',
  },
  profileImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  profileInitial: {
    fontSize: 32,
    fontWeight: 700,
    color: '#888',
  },
  profileOverlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0,
    transition: 'opacity 0.2s',
    borderRadius: '50%',
  },

  // Message avatars
  messageAvatar: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: '#2a2a36',
    flexShrink: 0,
    alignSelf: 'flex-end',
    marginRight: 8,
  },
  messageAvatarImg: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
  },
  messageAvatarInitial: {
    fontSize: 14,
    fontWeight: 700,
    color: '#888',
  },

  // Message image attachments
  messageImage: {
    maxWidth: '100%',
    maxHeight: 300,
    borderRadius: 8,
    marginTop: 4,
    cursor: 'pointer',
    objectFit: 'contain',
  },

  // Image attachment UI
  attachBtn: {
    background: 'none',
    border: 'none',
    fontSize: 22,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 8,
    lineHeight: 1,
  },
  imagePreviewBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 16px',
    background: '#1c1c24',
    borderTop: '1px solid #2a2a36',
  },
  imagePreviewThumb: {
    height: 60,
    maxWidth: 120,
    borderRadius: 8,
    objectFit: 'cover',
  },
  imagePreviewRemove: {
    background: 'rgba(255,255,255,0.1)',
    border: 'none',
    color: '#ccc',
    fontSize: 16,
    cursor: 'pointer',
    borderRadius: '50%',
    width: 24,
    height: 24,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Reply quote inside message bubble
  replyQuote: {
    background: 'rgba(0,0,0,0.2)',
    borderLeft: '3px solid rgba(255,255,255,0.3)',
    borderRadius: 4,
    padding: '4px 8px',
    marginBottom: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    cursor: 'pointer',
  },
  replyQuoteSender: {
    fontSize: 11,
    fontWeight: 700,
    opacity: 0.7,
  },
  replyQuoteText: {
    fontSize: 12,
    opacity: 0.7,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    maxWidth: 250,
  },

  // Reply preview bar above input
  replyPreviewBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 16px',
    background: '#1c1c24',
    borderTop: '1px solid #2a2a36',
    borderLeft: '3px solid #1a56db',
  },
  replyPreviewContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    overflow: 'hidden',
    flex: 1,
  },
  replyPreviewSender: {
    fontSize: 12,
    fontWeight: 700,
    color: '#1a56db',
  },
  replyPreviewText: {
    fontSize: 13,
    color: '#888',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  replyPreviewClose: {
    background: 'none',
    border: 'none',
    color: '#888',
    fontSize: 16,
    cursor: 'pointer',
    padding: '4px 8px',
    flexShrink: 0,
  },
};
