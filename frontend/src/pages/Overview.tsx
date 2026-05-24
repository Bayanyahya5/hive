import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';
import { Play, Users, BrainCircuit, AlertCircle } from 'lucide-react';

const PARTY_COLORS: Record<string, string> = {
    "Ra'am": '#00C49F',
    "Hadash": '#FF8042',
    "Balad": '#FFBB28',
    "Ta'al": '#8884d8',
    "Jewish-sector party": '#0088FE',
    "unclear": '#9ca3af',
    "Unclassified": '#d1d5db'
  };
export default function Overview() {
  const [stats, setStats] = useState({
    total: 0,
    classified: 0,
    unclassified: 0,
  });
  const [chartData, setChartData] = useState<{ name: string; value: number }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [pipelineMessage, setPipelineMessage] = useState<string | null>(null);

  const fetchStats = async () => {
    // Fetch total profiles
    const { count: totalCount } = await supabase
      .from('profiles')
      .select('*', { count: 'exact', head: true });

    // Fetch classifications to group them
    const { data: classifications } = await supabase
      .from('classifications')
      .select('party');

    const total = totalCount || 0;
    const classified = classifications?.length || 0;
    const unclassified = total - classified;

    setStats({ total, classified, unclassified });

    // Group for the pie chart
    if (classifications) {
      const counts = classifications.reduce((acc: any, curr) => {
        acc[curr.party] = (acc[curr.party] || 0) + 1;
        return acc;
      }, {});
      
      setChartData(Object.keys(counts).map(key => ({ name: key, value: counts[key] })));
    }
  };

  useEffect(() => {
    fetchStats();

    // The Rubric Requirement: Real-time updates via Supabase subscriptions
    const channel = supabase.channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'classifications' },
        () => {
          fetchStats(); // Refresh data instantly when AI finishes a row
        }
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'clusters' },
        () => fetchStats()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const runPipeline = async () => {
    setIsProcessing(true);
    setPipelineMessage('Starting classification pipeline...');
  
    const MAX_CLASSIFY_ROUNDS = 25; // 25 × 10 = 250 profiles max
    const MAX_CLUSTER_ROUNDS = 10;
  
    try {
      // ── Phase 1: Classify all unclassified profiles ──
      let classifyRound = 0;
      while (classifyRound < MAX_CLASSIFY_ROUNDS) {
        setPipelineMessage(`Classifying profiles (batch ${classifyRound + 1})...`);
  
        const { data, error } = await supabase.functions.invoke('classify-profiles');
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
  
        await fetchStats();
  
        if (data?.message === 'No unclassified profiles found.') {
          break;
        }
  
        if (data?.processed) {
          setPipelineMessage(`Classified ${data.processed} profiles (batch ${classifyRound + 1})...`);
        }
  
        classifyRound++;
      }
  
      if (classifyRound >= MAX_CLASSIFY_ROUNDS) {
        throw new Error('Classification stopped: max rounds reached. Some profiles may remain unclassified.');
      }
  
      // ── Phase 2: Cluster all "unclear" profiles ──
      let clusterRound = 0;
      while (clusterRound < MAX_CLUSTER_ROUNDS) {
        setPipelineMessage(`Clustering unclear profiles (run ${clusterRound + 1})...`);
  
        const { data, error } = await supabase.functions.invoke('cluster-profiles');
        if (error) throw error;
        if (data?.error) throw new Error(data.error);
  
        await fetchStats();
  
        if (data?.message === 'No unclear profiles need clustering.') {
          break;
        }
  
        if (data?.success) {
          setPipelineMessage(data.message || 'Clustering complete for this batch.');
        }
  
        clusterRound++;
      }
  
      if (clusterRound >= MAX_CLUSTER_ROUNDS) {
        throw new Error('Clustering stopped: max rounds reached. Some unclear profiles may remain unclustered.');
      }
  
      setPipelineMessage('Pipeline complete! All profiles classified and unclear profiles clustered.');
      await fetchStats();
  
    } catch (err: any) {
      setPipelineMessage(`Pipeline error: ${err.message}`);
      alert('Error running pipeline: ' + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h2 className="text-3xl font-bold text-gray-900">System Overview</h2>
          <p className="text-gray-500 mt-1">Real-time political discourse analysis</p>
        </div>
        <button
          onClick={runPipeline}
          disabled={isProcessing}
          className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-semibold flex items-center gap-2 disabled:opacity-50 transition-all shadow-md"
        >
          {isProcessing ? <BrainCircuit className="animate-pulse" /> : <Play size={20} />}
          {isProcessing ? 'Pipeline Running...' : 'Run Classification Pipeline'}
        </button>
      </div>

      {pipelineMessage && (
        <div
          className={`p-4 rounded-xl border text-sm font-medium ${
            pipelineMessage.startsWith('Pipeline error')
              ? 'bg-red-50 border-red-200 text-red-700'
              : pipelineMessage.startsWith('Pipeline complete')
              ? 'bg-green-50 border-green-200 text-green-700'
              : 'bg-blue-50 border-blue-200 text-blue-700'
          }`}
        >
          {pipelineMessage}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-blue-100 p-4 rounded-full text-blue-600"><Users size={24} /></div>
          <div>
            <p className="text-gray-500 text-sm font-medium">Total Profiles</p>
            <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-green-100 p-4 rounded-full text-green-600"><BrainCircuit size={24} /></div>
          <div>
            <p className="text-gray-500 text-sm font-medium">Classified Profiles</p>
            <p className="text-2xl font-bold text-gray-900">{stats.classified}</p>
          </div>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4">
          <div className="bg-orange-100 p-4 rounded-full text-orange-600"><AlertCircle size={24} /></div>
          <div>
            <p className="text-gray-500 text-sm font-medium">Unclassified</p>
            <p className="text-2xl font-bold text-gray-900">
              {stats.unclassified} ({stats.total > 0 ? Math.round((stats.unclassified / stats.total) * 100) : 0}%)
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 h-[400px]">
        <h3 className="text-lg font-bold text-gray-900 mb-4">Party Distribution</h3>
        {chartData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={chartData} cx="50%" cy="50%" innerRadius={80} outerRadius={120} paddingAngle={5} dataKey="value">
                {chartData.map((entry, index) => (
                  <Cell 
                  key={`cell-${index}`} 
                  fill={PARTY_COLORS[entry.name] || '#0088FE'} 
                />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-400">
            No classification data available yet. Run the pipeline!
          </div>
        )}
      </div>
    </div>
  );
}