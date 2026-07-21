import { useCallback, useEffect, useRef, useState } from "react";

interface UseSpeechRecognitionOptions {
  language?: string;
  continuous?: boolean;
  interimResults?: boolean;
  onResult?: (transcript: string, isFinal: boolean) => void;
  onError?: (error: string) => void;
  onEnd?: () => void;
}

interface UseSpeechRecognitionReturn {
  isSupported: boolean;
  isListening: boolean;
  isSpeechEnded: boolean;
  interimTranscript: string;
  finalTranscript: string;
  error: string | null;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  reset: () => void;
}

interface SpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionEvent {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  [index: number]: SpeechRecognitionResult;
  length: number;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent {
  error: string;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition: SpeechRecognitionConstructor;
    webkitSpeechRecognition: SpeechRecognitionConstructor;
  }
}

export function useSpeechRecognition(options: UseSpeechRecognitionOptions = {}): UseSpeechRecognitionReturn {
  const {
    language = "en-US",
    continuous = true,
    interimResults = true,
    onResult,
    onError,
    onEnd,
  } = options;

  const [isListening, setIsListening] = useState(false);
  const [isSpeechEnded, setIsSpeechEnded] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [finalTranscript, setFinalTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const finalRef = useRef("");

  const SpeechRecognitionAPI =
    typeof window !== "undefined"
      ? window.SpeechRecognition ?? window.webkitSpeechRecognition
      : undefined;

  const isSupported = !!SpeechRecognitionAPI;

  const resetTranscripts = useCallback(() => {
    setInterimTranscript("");
    setFinalTranscript("");
    finalRef.current = "";
  }, []);

  const start = useCallback(() => {
    if (!SpeechRecognitionAPI) {
      setError("Speech recognition not supported");
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.abort();
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.lang = language;
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;

    recognition.onstart = () => {
      setIsListening(true);
      setIsSpeechEnded(false);
      setError(null);
    };

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      let final = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          final += result[0].transcript;
        } else {
          interim += result[0].transcript;
        }
      }

      if (final) {
        finalRef.current += final;
        setFinalTranscript(finalRef.current);
        onResult?.(finalRef.current, true);

        if (continuous && !recognition.continuous) {
          setInterimTranscript("");
        } else {
          setInterimTranscript(interim);
        }
      } else {
        setInterimTranscript(interim);
        onResult?.(finalRef.current + interim, false);
      }
    };

    recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
      const message = event.error;
      setError(message);
      setIsListening(false);
      onError?.(message);
    };

    recognition.onend = () => {
      setIsListening(false);
      setIsSpeechEnded(true);
      onEnd?.();
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [SpeechRecognitionAPI, language, continuous, interimResults, onResult, onError, onEnd]);

  const stop = useCallback(() => {
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
  }, []);

  const toggle = useCallback(() => {
    if (isListening) {
      stop();
    } else {
      start();
    }
  }, [isListening, start, stop]);

  const reset = useCallback(() => {
    stop();
    resetTranscripts();
    setError(null);
  }, [stop, resetTranscripts]);

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
      recognitionRef.current = null;
    };
  }, []);

  return {
    isSupported,
    isListening,
    isSpeechEnded,
    interimTranscript,
    finalTranscript,
    error,
    start,
    stop,
    toggle,
    reset,
  };
}
