import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { ShieldCheck, AlertTriangle, Trash2, Download, FileCheck, ToggleLeft, ToggleRight, ChevronUp, ChevronDown } from 'lucide-react';

export default function Privacy() {
  const [profiles, setProfiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState<string | null>(null);
  
  // Sorting State
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'last_updated', direction: 'desc' });

  useEffect(() => {
    fetchAllPrivacyData();
  }, []);

  const fetchAllPrivacyData = async () => {
    setLoading(true);
    
    const { data: profilesData, error: pErr } = await supabase.from('profiles').select('*');
    const { data: consentData, error: cErr } = await supabase.from('consent_log').select('*');

    if (pErr) console.error("Profiles fetch error:", pErr);
    if (cErr) console.error("Consent fetch error:", cErr);

    if (profilesData) {
      const merged = profilesData.map(profile => {
        const userConsents = (consentData || []).filter(c => c.profile_id === profile.id);
        
        const sortedConsents = userConsents.sort((a, b) => {
          const timeA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
          const timeB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
          return timeB - timeA;
        });
        
        const latestConsent = sortedConsents[0];
        
        let validDate = profile.created_at;
        if (latestConsent?.timestamp) {
          validDate = latestConsent.timestamp;
        }

        const profileAgeMs = Date.now() - new Date(profile.created_at).getTime();
        const isRetentionExpired = profileAgeMs > 30 * 24 * 60 * 60 * 1000;

        let deletion_reason: 'opt-out' | 'retention' | 'flagged' | null = null;
        if (profile.needs_deletion) {
          if (latestConsent?.scope === 'opt-out') {
            deletion_reason = 'opt-out';
          } else if (isRetentionExpired) {
            deletion_reason = 'retention';
          } else {
            deletion_reason = 'flagged';
          }
        }

        return {
          ...profile,
          consent_status: latestConsent?.scope || 'Missing',
          last_updated: validDate,
          deletion_reason,
          account_age_days: Math.floor(profileAgeMs / (24 * 60 * 60 * 1000)),
          is_retention_expired: isRetentionExpired,
        };
      });
      
      setProfiles(merged);
    }
    setLoading(false);
  };

  const purgeUserData = async (id: string) => {
    if (!window.confirm("WARNING: This will permanently delete this user's profile and all associated data. Proceed?")) return;

    setProcessingId(id);

    try {
      const { data, error } = await supabase.functions.invoke('delete-user', {
        body: { target_profile_id: id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setProfiles(prev => prev.filter(p => p.id !== id));
    } catch (err: any) {
      alert('Failed to delete user: ' + err.message);
    }

    setProcessingId(null);
  };

  const toggleOptOut = async (id: string, currentStatus: boolean) => {
    setProcessingId(id);
    const newStatus = !currentStatus;
  
    const { error: updateError } = await supabase
      .from('profiles')
      .update({ needs_deletion: newStatus })
      .eq('id', id);
  
    if (updateError) {
      alert('Failed to update status: ' + updateError.message);
      setProcessingId(null);
      return;
    }
  
    // GDPR audit trail: record every opt-out / opt-in change
    const { error: consentError } = await supabase.from('consent_log').insert({
      profile_id: id,
      scope: newStatus ? 'opt-out' : 'Political discourse analysis',
      source: 'admin dashboard',
    });
  
    if (consentError) {
      alert('Status updated, but consent log failed: ' + consentError.message);
    }
  
    await fetchAllPrivacyData();
    setProcessingId(null);
  };

  const downloadJson = (data: object, filename: string) => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(data, null, 2));
    const anchor = document.createElement('a');
    anchor.setAttribute('href', dataStr);
    anchor.setAttribute('download', filename);
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };

  const exportUserData = async (profile: any) => {
    setProcessingId(profile.id);

    try {
      const { data, error } = await supabase.functions.invoke('export-gdpr', {
        body: { target_profile_id: profile.id },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      downloadJson(
        data,
        `gdpr_export_${profile.name.replace(/\s+/g, '_')}.json`
      );
    } catch (err: any) {
      alert('Export failed: ' + err.message);
    }

    setProcessingId(null);
  };

  const formatDate = (val: any) => {
    try {
      if (!val) return 'N/A';
      const d = new Date(val);
      if (isNaN(d.getTime())) return 'N/A';
      return d.toLocaleDateString();
    } catch (e) {
      return 'N/A';
    }
  };

  // --- SORTING LOGIC ---
  const handleSort = (key: string) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  const sortedProfiles = [...profiles].sort((a, b) => {
    let valA = a[sortConfig.key] || '';
    let valB = b[sortConfig.key] || '';

    if (sortConfig.key === 'last_updated') {
      const timeA = new Date(valA).getTime() || 0;
      const timeB = new Date(valB).getTime() || 0;
      if (timeA < timeB) return sortConfig.direction === 'asc' ? -1 : 1;
      if (timeA > timeB) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    }

    const strA = String(valA).toLowerCase();
    const strB = String(valB).toLowerCase();
    if (strA < strB) return sortConfig.direction === 'asc' ? -1 : 1;
    if (strA > strB) return sortConfig.direction === 'asc' ? 1 : -1;
    return 0;
  });

  const pendingDeletions = sortedProfiles.filter(p => p.needs_deletion);
  const activeUsers = sortedProfiles.filter(p => !p.needs_deletion);

  // --- UI HELPER ---
  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey) return <ChevronUp size={14} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity" />;
    return sortConfig.direction === 'asc' ? <ChevronUp size={14} className="text-blue-600" /> : <ChevronDown size={14} className="text-blue-600" />;
  };
  
  const DeletionReasonBadge = ({ reason }: { reason: 'opt-out' | 'retention' | 'flagged' | null }) => {
    if (reason === 'opt-out') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-200">
          User Opt-Out
        </span>
      );
    }
    if (reason === 'retention') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
          Retention Expired
        </span>
      );
    }
    if (reason === 'flagged') {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-gray-100 text-gray-700 border border-gray-200">
          Flagged for Deletion
        </span>
      );
    }
    return <span className="text-xs text-gray-400">—</span>;
  };

  const RetentionBadge = ({ accountAgeDays, isRetentionExpired }: { accountAgeDays: number; isRetentionExpired: boolean }) => {
    if (isRetentionExpired) {
      return (
        <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-purple-100 text-purple-800 border border-purple-200">
          Retention flag due ({accountAgeDays}d)
        </span>
      );
    }
    return (
      <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-100">
        Day {accountAgeDays} / 30
      </span>
    );
  };

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-end">
        <div>
          <h2 className="text-3xl font-bold text-gray-900 flex items-center gap-3">
            <ShieldCheck className="text-green-600" size={32} />
            GDPR Compliance Center
          </h2>
          <p className="text-gray-500 mt-1">Manage data retention, consent logs, and user deletion requests</p>
        </div>
      </div>

      {/* SECTION 1: Action Required Queue */}
      {pendingDeletions.length > 0 && (
        <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="bg-red-50 border border-red-200 rounded-xl p-5 flex items-start gap-4">
            <AlertTriangle className="text-red-600 shrink-0 mt-1" />
            <div>
              <h3 className="font-bold text-red-900 text-lg">Action Required: Data Purge</h3>
              <p className="text-red-700 mt-1 text-sm">
                The following users have explicitly opted out or were flagged for deletion. Under GDPR, their data must be permanently erased.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-xl shadow-sm border border-red-100 overflow-hidden">
            <div className="bg-red-50/50 p-4 border-b border-red-100 flex justify-between items-center">
              <h3 className="font-semibold text-red-900">Pending Deletion Queue</h3>
              <span className="bg-red-100 text-red-700 text-xs font-bold px-3 py-1 rounded-full border border-red-200">
                {pendingDeletions.length} Pending
              </span>
            </div>

            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white border-b border-gray-100">
                  <th onClick={() => handleSort('name')} className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group select-none">
                    <div className="flex items-center gap-1.5">User <SortIcon columnKey="name" /></div>
                  </th>
                  <th onClick={() => handleSort('last_updated')} className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group select-none">
                    <div className="flex items-center gap-1.5">Opt-Out Date <SortIcon columnKey="last_updated" /></div>
                  </th>
                  <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Deletion Reason
                  </th>
                  <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Retention
                  </th>
                  <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider text-right pr-20">
                    Action
                  </th>
                </tr>
              </thead>
              <tbody>
                {pendingDeletions.map((profile) => (
                  <tr key={profile.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                    <td className="p-4">
                      <p className="font-medium text-gray-900">{profile.name}</p>
                      <p className="font-mono text-xs text-gray-400 mt-0.5">{profile.id.split('-')[0]}...</p>
                    </td>
                    <td className="p-4 text-gray-600 text-sm">
                      {formatDate(profile.last_updated)}
                    </td>
                    <td className="p-4">
                      <DeletionReasonBadge reason={profile.deletion_reason} />
                    </td>
                    <td className="p-4">
                      <RetentionBadge
                        accountAgeDays={profile.account_age_days}
                        isRetentionExpired={profile.is_retention_expired}
                      />
                    </td>
                    <td className="p-4 text-right flex items-center justify-end gap-4">
                      <button
                        onClick={() => toggleOptOut(profile.id, profile.needs_deletion)}
                        disabled={processingId === profile.id}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-blue-600 transition-colors disabled:opacity-50"
                        title="Cancel Deletion (Toggle Opt-In)"
                      >
                        <ToggleRight size={28} className="text-red-500" />
                        <span className="text-xs font-medium">Opted Out</span>
                      </button>
                      
                      <button
                        onClick={() => purgeUserData(profile.id)}
                        disabled={processingId === profile.id}
                        className="inline-flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                      >
                        {processingId === profile.id ? 'Purging...' : <><Trash2 size={16} /> Purge Data</>}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* SECTION 2: Global Consent Management */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="bg-gray-50 p-4 border-b border-gray-100 flex justify-between items-center">
          <div className="flex items-center gap-2">
            <FileCheck className="text-gray-400" size={18} />
            <h3 className="font-semibold text-gray-700">Active Consent Directory</h3>
          </div>
          <span className="bg-green-100 text-green-700 text-xs font-bold px-3 py-1 rounded-full border border-green-200">
            {activeUsers.length} Compliant Records
          </span>
        </div>

        {loading ? (
          <div className="p-12 text-center text-gray-500">Loading compliance logs...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[800px]">
              <thead>
                <tr className="bg-white border-b border-gray-100">
                  <th onClick={() => handleSort('name')} className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group select-none">
                    <div className="flex items-center gap-1.5">User Name <SortIcon columnKey="name" /></div>
                  </th>
                  <th onClick={() => handleSort('consent_status')} className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group select-none">
                    <div className="flex items-center gap-1.5">Consent Status <SortIcon columnKey="consent_status" /></div>
                  </th>
                  <th onClick={() => handleSort('last_updated')} className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group select-none">
                    <div className="flex items-center gap-1.5">Last Updated <SortIcon columnKey="last_updated" /></div>
                  </th>
                  <th onClick={() => handleSort('account_age_days')} className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider cursor-pointer hover:bg-gray-50 transition-colors group select-none">
                    <div className="flex items-center gap-1.5">Retention <SortIcon columnKey="account_age_days" /></div>
                  </th>
                  <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider">
                    Privacy Pref.
                  </th>
                  {/* pr-16 shifts the text left to hover perfectly over the buttons */}
                  <th className="p-4 font-semibold text-gray-500 text-xs uppercase tracking-wider text-right pr-16">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.length > 0 ? activeUsers.map((profile) => (
                  <tr key={profile.id} className="border-b border-gray-50 hover:bg-blue-50/30 transition-colors">
                    <td className="p-4 font-medium text-gray-900">{profile.name}</td>
                    
                    <td className="p-4">
                      <span className={`px-2.5 py-1 rounded-md text-xs font-semibold ${
                          profile.consent_status === 'opt-out' ? 'bg-red-100 text-red-700' :
                          profile.consent_status === 'Political discourse analysis' ? 'bg-green-100 text-green-700' :
                          profile.consent_status === 'Missing' ? 'bg-gray-100 text-gray-600' :
                          'bg-yellow-100 text-yellow-700'
                      }`}>
                        {profile.consent_status}
                      </span>
                    </td>
                    
                    <td className="p-4 text-gray-500 text-sm">
                      {formatDate(profile.last_updated)}
                    </td>

                    <td className="p-4">
                      <RetentionBadge
                        accountAgeDays={profile.account_age_days}
                        isRetentionExpired={profile.is_retention_expired}
                      />
                    </td>
                    
                    <td className="p-4">
                      <button 
                        onClick={() => toggleOptOut(profile.id, profile.needs_deletion)}
                        disabled={processingId === profile.id}
                        className="flex items-center gap-1.5 text-gray-500 hover:text-red-500 transition-colors disabled:opacity-50"
                        title="Toggle Opt-Out (Move to deletion queue)"
                      >
                        <ToggleLeft size={28} className="text-gray-300" />
                        <span className="text-xs font-medium">Opted In</span>
                      </button>
                    </td>

                    <td className="p-4 text-right flex items-center justify-end gap-2">
                      <button
                        onClick={() => exportUserData(profile)}
                        className="inline-flex items-center gap-1.5 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors shadow-sm"
                        title="Export JSON Data"
                      >
                        <Download size={14} /> Export
                      </button>
                      
                      <button
                        onClick={() => purgeUserData(profile.id)}
                        disabled={processingId === profile.id}
                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors border border-transparent hover:border-red-100"
                        title="Trigger immediate permanent deletion"
                      >
                        <Trash2 size={18} />
                      </button>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={6} className="p-10 text-center text-gray-500">No active records found.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}