
import React from 'react';

interface Props {
  onSettingsClick: () => void;
  isSettingsOpen: boolean;
}

const CompactDashboard: React.FC<Props> = ({ onSettingsClick, isSettingsOpen }) => {
  return (
    <div className="flex items-center justify-between py-2 opacity-30">
      <h1 className="text-[10px] font-black uppercase tracking-[0.5em] text-white">
        DriveDialer
      </h1>
      <button 
        onClick={onSettingsClick}
        className="text-[10px] font-bold uppercase tracking-widest text-white px-4 py-2"
      >
        {isSettingsOpen ? 'Sluiten' : 'Opties'}
      </button>
    </div>
  );
};

export default CompactDashboard;
