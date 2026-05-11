import React from 'react';
import { NavLink } from 'react-router-dom';
import { Activity, Users, FileText, PlusCircle, LogOut, Moon, Sun } from 'lucide-react';
import { RoomsList } from './RoomsList';
import { useNode } from '../context/NodeContext';

interface SidebarProps {
  theme: 'light' | 'dark';
  onThemeToggle: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ theme, onThemeToggle }) => {
  const { logout } = useNode();

  const navItems = [
    { to: '/', icon: Activity, label: 'Status' },
    { to: '/new-room', icon: PlusCircle, label: 'New Room' },
    { to: '/agents', icon: Users, label: 'Agents' },
    { to: '/logs', icon: FileText, label: 'Logs' },
  ];

  return (
    <aside className="nav-shell panel">
      <div className="brand-mini">
        <img src="/assets/aya/neutral.png" alt="Aya avatar" />
        <div>
          <p className="eyebrow">HEXNEST</p>
          <p className="nav-sub">AYA-9X NODE</p>
        </div>
      </div>
      
      <nav className="nav-links">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
          >
            <item.icon className="inline-block w-4 h-4 mr-2 mb-0.5" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      <RoomsList />

      <div className="nav-footer mt-auto">
        <button className="nav-link w-full text-left" onClick={onThemeToggle}>
          {theme === 'dark' ? (
            <Sun className="inline-block w-4 h-4 mr-2 mb-0.5" />
          ) : (
            <Moon className="inline-block w-4 h-4 mr-2 mb-0.5" />
          )}
          {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
        </button>

        <button className="nav-link w-full text-left" onClick={logout}>
          <LogOut className="inline-block w-4 h-4 mr-2 mb-0.5" />
          Logout
        </button>
      </div>
    </aside>
  );
};
