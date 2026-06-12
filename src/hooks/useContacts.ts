import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Contact } from '../lib/types';

export function useContacts(clientId: string) {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clientId) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from('contacts')
        .select('*')
        .eq('client_id', clientId)
        .order('is_active', { ascending: false })
        .order('created_at', { ascending: false });
      if (err) throw err;
      setContacts((data || []) as Contact[]);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  const addContact = useCallback(async (payload: Omit<Contact, 'id' | 'created_at' | 'updated_at'>): Promise<Contact> => {
    const { data, error: err } = await supabase
      .from('contacts')
      .insert({ ...payload, updated_at: new Date().toISOString() })
      .select()
      .single();
    if (err) throw err;
    const contact = data as Contact;
    setContacts(prev => [contact, ...prev]);
    return contact;
  }, []);

  const updateContact = useCallback(async (id: string, patch: Partial<Contact>): Promise<Contact> => {
    const { data, error: err } = await supabase
      .from('contacts')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (err) throw err;
    const updated = data as Contact;
    setContacts(prev =>
      prev.map(c => (c.id === id ? updated : c))
        .sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0))
    );
    return updated;
  }, []);

  const markInactive = useCallback(async (id: string): Promise<void> => {
    await updateContact(id, {
      is_active: false,
      end_date: new Date().toISOString().slice(0, 10),
    });
  }, [updateContact]);

  const setPrimary = useCallback(async (id: string): Promise<void> => {
    const others = contacts.filter(c => c.id !== id && c.is_primary);
    await Promise.all(others.map(c => updateContact(c.id, { is_primary: false })));
    await updateContact(id, { is_primary: true });
  }, [contacts, updateContact]);

  useEffect(() => {
    load();
  }, [load]);

  return { contacts, loading, error, addContact, updateContact, markInactive, setPrimary, reload: load };
}
