
import React from 'react';
import { Contact } from '../types';

interface ContactListProps {
  contacts: Contact[];
  setContacts: (c: Contact[]) => void;
}

const ContactList: React.FC<ContactListProps> = ({ contacts, setContacts }) => {
  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-3xl font-bold">Mijn Bellijst</h2>
        <button className="bg-slate-800 px-4 py-2 rounded-xl text-sm font-bold border border-slate-700">
          Importeer Sheet (CSV)
        </button>
      </div>

      <div className="space-y-3">
        {contacts.map((contact, idx) => (
          <div key={contact.id} className={`p-6 rounded-3xl border transition-all ${contact.status === 'called' ? 'bg-slate-900/50 border-slate-800 opacity-50' : 'bg-slate-900 border-slate-800 shadow-lg'}`}>
            <div className="flex justify-between items-start">
              <div>
                <p className="font-bold text-xl">{contact.name}</p>
                <p className="text-slate-400 text-sm mt-1">{contact.subject}</p>
                <p className="text-blue-400 text-xs mt-2 font-mono">{contact.phone}</p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${contact.status === 'called' ? 'bg-green-500/20 text-green-500' : 'bg-blue-500/20 text-blue-500'}`}>
                  {contact.status === 'called' ? 'Gebeld' : 'Wachtrij'}
                </span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ContactList;
