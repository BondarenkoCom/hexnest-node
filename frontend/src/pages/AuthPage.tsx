import React, { useState, useEffect } from 'react';
import { useNode } from '../context/NodeContext';
import { useAyaState } from '../hooks/useAyaState';
import { AyaCompanion } from '../components/AyaCompanion';
import AyaLoader from '../components/AyaLoader';


export const AuthPage: React.FC = () => {
  const { refresh, addNotification } = useNode();
  const [isLogin, setIsLogin] = useState(true);
  const aya = useAyaState(isLogin ? "signin" : "signup");
  
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Form states
  const [name, setName] = useState('');
  const [nodeName, setNodeName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Validation states
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    // Check if all fields are valid for Aya reactions
    const isValid = isLogin 
      ? (email.includes('@') && password.length >= 6)
      : (name.length >= 2 && nodeName.length >= 2 && email.includes('@') && password.length >= 6 && password === confirmPassword);
    
    aya.onAllFieldsValid(isValid);
  }, [isLogin, name, nodeName, email, password, confirmPassword, aya]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrors({});

    const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register';
    const body = isLogin 
      ? { email: email.toLowerCase(), password }
      : { name, nodeName, email: email.toLowerCase(), password };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      const json = await res.json();
      if (json.success) {
        aya.onSubmitSuccess();
        setTimeout(() => refresh(), 800);
      } else {
        setErrors({ form: json.error || 'Authentication failed' });
        aya.onSubmitError(1);
        addNotification(json.error || 'Auth failed', 'error');
      }
    } catch (err) {
      setErrors({ form: 'Network error occurred' });
      aya.onSubmitError(1);
    } finally {
      setLoading(false);
    }
  };

  const handlePasswordStrength = (val: string) => {
    setPassword(val);
    if (!val) return;
    const strength = val.length < 8 ? "weak" : val.length < 12 ? "medium" : "strong";
    aya.onPasswordStrength(strength);
  };

  return (
    <main className="auth-page">
      <div className="modal-content">
        {loading ? (
          <AyaLoader 
            title={isLogin ? "AUTHENTICATING" : "CREATING IDENTITY"}
            subtitle="Syncing with the return-to-swarm protocol..."
            variant="panel"
          />
        ) : (
          <>
            <AyaCompanion 
              mode={isLogin ? "signin" : "signup"}
              state={aya.state}
              sprite={aya.sprite}
              bubble={aya.bubble}
              reacting={aya.reacting}
            />

            <div className="auth-form-wrap">
              <p className="eyebrow">{isLogin ? 'HEXNEST // RETURN TO SWARM' : 'HEXNEST // CYBERBRAIN ACCESS'}</p>
              <h1>{isLogin ? 'Sign In' : 'Create Account'}</h1>
              <p className="sub">
                {isLogin 
                  ? 'Use your operator account to manage node status and registration.' 
                  : 'Register your operator account and attach nodes to your dashboard.'}
              </p>

            <form className="auth-form" onSubmit={handleSubmit}>
              {!isLogin && (
                <>
                  <div className="form-group">
                    <label htmlFor="name">Full Name</label>
                    <input
                      id="name"
                      type="text"
                      placeholder="Operator Name"
                      value={name}
                      onFocus={() => aya.onFocus('name')}
                      onChange={(e) => {
                        setName(e.target.value);
                        aya.onNameValidation(e.target.value);
                      }}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="nodeName">Node Name</label>
                    <input
                      id="nodeName"
                      type="text"
                      placeholder="e.g. primary-node-01"
                      value={nodeName}
                      onFocus={() => aya.onFocus('nodeName')}
                      onChange={(e) => setNodeName(e.target.value)}
                      required
                    />
                  </div>
                </>
              )}

              <div className="form-group">
                <label htmlFor="email">Email Address</label>
                <input
                  id="email"
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onFocus={() => aya.onFocus('email')}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    aya.onEmailValidation(e.target.value.includes('@'));
                  }}
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="password">Password</label>
                <div className="auth-password-row">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={password}
                    onFocus={() => aya.onFocus('password')}
                    onChange={(e) => handlePasswordStrength(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="auth-toggle"
                    onClick={() => {
                      setShowPassword(!showPassword);
                      aya.onPasswordToggle();
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {!isLogin && (
                <div className="form-group">
                  <label htmlFor="confirmPassword">Confirm Password</label>
                  <input
                    id="confirmPassword"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onFocus={() => aya.onFocus('confirm')}
                    onChange={(e) => {
                      setConfirmPassword(e.target.value);
                      aya.onConfirmMatch(e.target.value === password);
                    }}
                    required
                  />
                </div>
              )}

              {errors.form && <p className="meta" style={{ color: 'var(--blood-soft)' }}>{errors.form}</p>}

              <div className="actions" style={{ marginTop: '14px' }}>
                <button
                  type="submit"
                  disabled={loading}
                  onMouseEnter={() => aya.onSubmitHover()}
                  onMouseLeave={() => aya.onSubmitLeave()}
                  className={loading ? 'loading' : ''}
                >
                  {loading ? (isLogin ? 'Signing In...' : 'Creating...') : (isLogin ? 'Sign In' : 'Create Account')}
                </button>
              </div>
            </form>

            <div className="auth-footer">
              <p>
                {isLogin ? "Need an account?" : "Already have an account?"}{' '}
                <button type="button" className="button-ghost" onClick={() => setIsLogin(!isLogin)}>
                  {isLogin ? 'Sign Up' : 'Sign In'}
                </button>
              </p>
            </div>
          </div>
        </>
      )}
      </div>
    </main>
  );
};
