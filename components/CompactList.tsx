
import React from 'react';
import { Contact } from '../types';

interface CompactListProps {
  contacts: Contact[];
  currentIndex: number;
}

const CompactList: React.FC<CompactListProps> = ({ contacts, currentIndex }) => {
  const upcoming = contacts.slice(currentIndex + 1);

  if (upcoming.length === 0) {
    return <p className="text-slate-600 text-center py-4 italic text-sm">Geen contacten meer.</p>;
  }

  return (
    <div className="space-y-4">
      {upcoming.map((contact) => (
        <div key={contact.id} className="flex items-center justify-between p-5 bg-white/5 border border-white/5 rounded-3xl opacity-50">
          <div className="flex items-center gap-5">
            <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center font-black text-white/20">
              {contact.name.charAt(0)}
            </div>
            <div>
              <p className="font-bold text-sm text-white">{contact.name}</p>
              <p className="text-[10px] text-white/30 uppercase tracking-widest">{contact.subject}</p>
            </div>
          </div>
          <p className="text-[10px] font-mono text-blue-500/50">{contact.phone}</p>
        </div>
      ))}
    </div>
  );
};

export default CompactList;
