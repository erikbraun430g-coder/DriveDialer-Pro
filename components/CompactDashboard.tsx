
import React from 'react';

interface CompactDashboardProps {
  onSettingsClick: () => void;
  isSettingsOpen: boolean;
}

const CompactDashboard: React.FC<CompactDashboardProps> = ({ onSettingsClick, isSettingsOpen }) => {
  return (
    <div className="bg-white/5 border border-white/10 p-6 rounded-[32px] flex items-center justify-between backdrop-blur-xl">
      <div className="flex items-center gap-5">
        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-600/20">
          <span className="text-2xl">🚗</span>
        </div>
        <div>
          <h1 className="text-lg font-black uppercase tracking-widest text-white leading-none">DriveDialer <span className="text-blue-500">PRO</span></h1>
          <p className="text-[9px] font-bold text-white/30 uppercase tracking-[0.2em] mt-2">Hands-free Interface v2.5</p>
        </div>
      </div>
      
      <button 
        onClick={onSettingsClick}
        className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all ${
          isSettingsOpen ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-white/5 text-white/40 hover:bg-white/10'
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
