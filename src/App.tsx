import React, { useState, useRef, useEffect } from 'react';
import { Button } from './components/button';
import * as Tone from 'tone';
import { analyzePitch } from './utils/analyzePitch';
import * as mm from '@magenta/music';

const App: React.FC = () => {
  const [isRecording, setIsRecording] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [detectedNotes, setDetectedNotes] = useState<string[]>([]);
  const [aiNotes, setAiNotes] = useState<string[]>([]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentNote, setCurrentNote] = useState<string | null>(null);
  const [selectedInstrument, setSelectedInstrument] = useState<'Synth' | 'AMSynth' | 'FMSynth'>('Synth');
  const [selectedDrum, setSelectedDrum] = useState<'Membrane' | 'Metal'>('Membrane');
  const [analysisProgress, setAnalysisProgress] = useState(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [tempo, setTempo] = useState(120);
  const [showTutorial, setShowTutorial] = useState(true);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const synthRef = useRef<Tone.PolySynth | null>(null);
  const drumRef = useRef<Tone.MembraneSynth | Tone.MetalSynth | null>(null);
  const pianoPartRef = useRef<Tone.Part | null>(null);
  const drumPartRef = useRef<Tone.Part | null>(null);
  const analyzerRef = useRef<Tone.Analyser | null>(null);
  const visualizerRef = useRef<HTMLCanvasElement>(null);
  const animationFrameId = useRef<number | null>(null);

  // Initialize audio context on first interaction
  useEffect(() => {
    const initAudio = async () => {
      await Tone.start();
      analyzerRef.current = new Tone.Analyser('waveform', 256);
    };

    document.addEventListener('click', initAudio, { once: true });
    return () => document.removeEventListener('click', initAudio);
  }, []);

  // Visualizer effect
  useEffect(() => {
    if (!isPlaying || !analyzerRef.current || !visualizerRef.current) return;

    const canvas = visualizerRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      const waveform = analyzerRef.current?.getValue() as Float32Array;
      if (!waveform) return;

      ctx.fillStyle = 'rgb(17, 24, 39)';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.lineWidth = 2;
      ctx.strokeStyle = 'rgb(59, 130, 246)';
      ctx.beginPath();

      const sliceWidth = canvas.width / waveform.length;
      let x = 0;

      for (let i = 0; i < waveform.length; i++) {
        const y = waveform[i] * canvas.height / 2 + canvas.height / 2;

        if (i === 0) {
          ctx.moveTo(x, y);
        } else {
          ctx.lineTo(x, y);
        }

        x += sliceWidth;
      }

      ctx.stroke();
      animationFrameId.current = requestAnimationFrame(draw);
    };

    animationFrameId.current = requestAnimationFrame(draw);

    return () => {
      if (animationFrameId.current) {
        cancelAnimationFrame(animationFrameId.current);
      }
    };
  }, [isPlaying]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioUrl(URL.createObjectURL(blob));
        analyzeRecording(blob);
      };

      mediaRecorder.start(100);
      setIsRecording(true);
      setShowTutorial(false);
    } catch (err) {
      console.error('Recording failed:', err);
      alert('Microphone access denied. Please allow microphone permissions.');
    }
  };

  const analyzeRecording = async (blob: Blob) => {
    setIsAnalyzing(true);
    setAnalysisProgress(0);
    
    try {
      const notes = await analyzePitch(blob, (progress) => {
        setAnalysisProgress(Math.floor(progress * 100));
      });
      
      const filtered = notes.filter((note) => {
        try {
          const midi = Tone.Frequency(note).toMidi();
          return midi >= 48 && midi <= 84;
        } catch {
          return false;
        }
      });
      
      setDetectedNotes(filtered);
      setAiNotes([]);
    } catch (err) {
      console.error('Analysis failed:', err);
      alert('Failed to analyze the recording. Please try again.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  const stopRecording = () => {
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current?.stream.getTracks().forEach(track => track.stop());
    setIsRecording(false);
  };

  const stopPlayback = () => {
    Tone.Transport.cancel();
    pianoPartRef.current?.dispose();
    drumPartRef.current?.dispose();
    setIsPlaying(false);
    setCurrentNote(null);
  };

  const playWithTone = async (notes: string[]) => {
    if (notes.length === 0 || isPlaying) return;

    await Tone.start();
    stopPlayback();

    // Initialize synth with effects
    let synth: Tone.PolySynth;
    switch (selectedInstrument) {
      case 'AMSynth':
        synth = new Tone.PolySynth(Tone.AMSynth).toDestination();
        break;
      case 'FMSynth':
        synth = new Tone.PolySynth(Tone.FMSynth).toDestination();
        break;
      default:
        synth = new Tone.PolySynth(Tone.Synth).toDestination();
    }
    
    const analyzer = new Tone.Analyser('waveform', 256);
    synth.chain(
      new Tone.Freeverb(0.4).toDestination(),
      analyzer
    );
    analyzerRef.current = analyzer;
    synthRef.current = synth;

    // Initialize drum
    let drum: Tone.MembraneSynth | Tone.MetalSynth;
    if (selectedDrum === 'Metal') {
      drum = new Tone.MetalSynth().toDestination();
    } else {
      drum = new Tone.MembraneSynth().toDestination();
    }
    drumRef.current = drum;

    // Set tempo
    Tone.Transport.bpm.value = tempo;

    // Create musical parts
    const pianoEvents: [number, string][] = notes.map((note, i) => [i * 0.5, note]);
    const drumEvents: [number, string][] = notes
      .filter((_, i) => i % 2 === 0)
      .map((_, i) => [i * 1.0, 'C2']);

    pianoPartRef.current = new Tone.Part((time, note) => {
      setCurrentNote(note);
      synth.triggerAttackRelease(note, '8n', time);
    }, pianoEvents).start(0);

    drumPartRef.current = new Tone.Part((time, note) => {
      drum.triggerAttackRelease(note, '8n', time);
    }, drumEvents).start(0);

    // Start playback
    setIsPlaying(true);
    Tone.Transport.start();

    // Schedule stop
    const duration = Math.max(pianoEvents.length, drumEvents.length) * 500 + 500;
    setTimeout(stopPlayback, duration);
  };

  const enhanceWithAI = async () => {
    if (detectedNotes.length === 0) return;

    const noteToMidi = (note: string): number => {
      const midi = Tone.Frequency(note).toMidi();
      return isNaN(midi) ? 60 : Math.min(Math.max(midi, 48), 84);
    };

    const midiToNote = (midi: number): string => Tone.Frequency(midi, 'midi').toNote();

    const sequence: mm.INoteSequence = {
      notes: detectedNotes.map((note, i) => ({
        pitch: noteToMidi(note),
        quantizedStartStep: i,
        quantizedEndStep: i + 1
      })),
      quantizationInfo: { stepsPerQuarter: 4 },
      totalQuantizedSteps: detectedNotes.length,
    };

    try {
      const model = new mm.MusicRNN('https://storage.googleapis.com/magentadata/js/checkpoints/music_rnn/melody_rnn');
      await model.initialize();
      const aiSeq = await model.continueSequence(sequence, 16, 0.8);
      const aiNoteNames = (aiSeq.notes || []).map((n) => midiToNote(n.pitch ?? 60));
      setAiNotes(aiNoteNames);
    } catch (err) {
      console.error('AI generation failed:', err);
      alert('AI enhancement failed. Please try again.');
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-start bg-gray-900 text-white p-4 relative">
      {/* Header */}
      <header className="w-full py-6 mb-8 bg-gradient-to-r from-purple-900 via-blue-800 to-indigo-900">
        <h1 className="text-4xl font-bold text-center">🎵 Hum-to-Music Composer</h1>
        <p className="text-gray-300 mt-2 text-center">Turn your humming into professional music</p>
      </header>

      {/* Tutorial modal */}
      {showTutorial && (
        <div className="fixed inset-0 bg-black bg-opacity-80 flex items-center justify-center z-50 p-4">
          <div className="bg-gray-800 rounded-xl p-6 max-w-md">
            <h2 className="text-2xl font-bold mb-4">How to use</h2>
            <ol className="list-decimal list-inside space-y-2 text-gray-300">
              <li>Click "Start Humming" and sing/hum a melody</li>
              <li>Click "Stop" when finished</li>
              <li>Use "AI Enhance" to expand your melody</li>
              <li>Select instruments and play your creation!</li>
            </ol>
            <div className="mt-6 flex justify-center">
              <Button onClick={() => setShowTutorial(false)}>Got it!</Button>
            </div>
          </div>
        </div>
      )}

      {/* Main controls */}
      <div className="w-full max-w-3xl bg-gray-800 rounded-xl p-6 shadow-xl">
        <div className="flex flex-wrap gap-4 justify-center">
          <Button 
            onClick={startRecording} 
            disabled={isRecording}
            className={isRecording ? 'animate-pulse' : ''}
          >
            {isRecording ? 'Recording...' : 'Start Humming'}
          </Button>
          <Button onClick={stopRecording} disabled={!isRecording}>Stop</Button>
          <Button 
            onClick={enhanceWithAI} 
            disabled={detectedNotes.length === 0 || isAnalyzing}
            variant="secondary"
          >
            {isAnalyzing ? 'Thinking...' : 'AI Enhance'}
          </Button>
        </div>

        {/* Progress indicator */}
        {isAnalyzing && (
          <div className="mt-4 w-full">
            <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all duration-300"
                style={{ width: `${analysisProgress}%` }}
              ></div>
            </div>
            <p className="text-center text-sm text-gray-400 mt-1">
              Analyzing... {analysisProgress}%
            </p>
          </div>
        )}

        {/* Instrument controls */}
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm text-gray-400 mb-2">🎹 Instrument</label>
            <select
              value={selectedInstrument}
              onChange={(e) => setSelectedInstrument(e.target.value as any)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2"
            >
              <option value="Synth">Basic Synth</option>
              <option value="AMSynth">AM Synth</option>
              <option value="FMSynth">FM Synth</option>
            </select>
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-2">🥁 Drum Type</label>
            <select
              value={selectedDrum}
              onChange={(e) => setSelectedDrum(e.target.value as any)}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2"
            >
              <option value="Membrane">Membrane</option>
              <option value="Metal">Metal</option>
            </select>
          </div>
        </div>

        {/* Tempo control */}
        <div className="mt-4">
          <label className="block text-sm text-gray-400 mb-2">Tempo: {tempo} BPM</label>
          <input
            type="range"
            min="60"
            max="180"
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Audio player and visualizer */}
      {audioUrl && (
        <div className="w-full max-w-3xl mt-6 bg-gray-800 rounded-xl p-6 shadow-xl">
          <audio controls src={audioUrl} className="w-full"></audio>
          
          <canvas
            ref={visualizerRef}
            className="w-full h-32 rounded-lg bg-gray-900 mt-4"
            width={800}
            height={128}
          />

          <div className="flex flex-wrap gap-3 justify-center mt-4">
            <Button onClick={() => playWithTone(detectedNotes)} disabled={isPlaying}>
              Play Original
            </Button>
            <Button 
              onClick={() => playWithTone(aiNotes)} 
              disabled={isPlaying || aiNotes.length === 0}
              variant="secondary"
            >
              Play AI Version
            </Button>
            <Button onClick={stopPlayback} disabled={!isPlaying} variant="danger">
              Stop
            </Button>
          </div>
        </div>
      )}

      {/* Current note display */}
      {currentNote && (
        <div className="mt-4 p-4 bg-gray-800 rounded-lg">
          <p className="text-xl text-center">
            Now playing: <span className="font-mono text-2xl text-yellow-400">{currentNote}</span>
          </p>
        </div>
      )}

      {/* Notes display */}
      <div className="w-full max-w-3xl mt-6 grid grid-cols-1 md:grid-cols-2 gap-6">
        {detectedNotes.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold mb-3 text-blue-400">🎶 Your Melody</h3>
            <div className="flex flex-wrap gap-2">
              {detectedNotes.map((note, idx) => (
                <span 
                  key={idx} 
                  className={`px-3 py-1 rounded-full ${
                    currentNote === note ? 'bg-yellow-600 text-white' : 'bg-gray-700 text-gray-300'
                  }`}
                >
                  {note}
                </span>
              ))}
            </div>
          </div>
        )}

        {aiNotes.length > 0 && (
          <div className="bg-gray-800 rounded-xl p-6 shadow-xl">
            <h3 className="text-lg font-semibold mb-3 text-green-400">🤖 AI Enhanced</h3>
            <div className="flex flex-wrap gap-2">
              {aiNotes.map((note, idx) => (
                <span 
                  key={idx} 
                  className={`px-3 py-1 rounded-full ${
                    currentNote === note ? 'bg-yellow-600 text-white' : 'bg-green-700 text-green-100'
                  }`}
                >
                  {note}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="mt-8 text-gray-500 text-sm">
        <p>Created with Tone.js and Magenta.js | {new Date().getFullYear()}</p>
      </footer>
    </div>
  );
};

export default App;