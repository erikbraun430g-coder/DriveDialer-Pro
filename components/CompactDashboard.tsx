
import React from 'react';

interface CompactDashboardProps {
  onSettingsClick: () => void;
  isSettingsOpen: boolean;
}

const CompactDashboard: React.FC<CompactDashboardProps> = ({ onSettingsClick, isSettingsOpen }) => {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center font-bold text-xl">
          🚗
        </div>
        <div>
          <h1 className="text-sm font-black uppercase tracking-[0.3em] text-white">DriveDialer</h1>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
            <p className="text-[9px] font-bold text-white/30 uppercase tracking-widest">System Online</p>
          </div>
        </div>
      </div>
      
      <button 
        onClick={onSettingsClick}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
          isSettingsOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-white/5 text-white/40'
        }`}
      >
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
        </svg>
      </button>
    </div>
  );
};

export default CompactDashboard;
