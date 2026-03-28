import { useState, useEffect, useCallback } from 'react';
import api from '@/api';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Profile } from '@/types';

interface SystemPromptsTabProps {
  profile: Profile | null;
  onSaveProfile: (data: Partial<Profile>) => Promise<Profile>;
}

export default function SystemPromptsTab({ profile, onSaveProfile }: SystemPromptsTabProps) {
  const [defaults, setDefaults] = useState<{ parse: string; chat: string } | null>(null);
  const [parsePrompt, setParsePrompt] = useState('');
  const [chatPrompt, setChatPrompt] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getDefaultPrompts()
      .then(setDefaults)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (profile) {
      setParsePrompt(profile.system_prompt_parse ?? '');
      setChatPrompt(profile.system_prompt_chat ?? '');
    }
  }, [profile]);

  const handleSave = useCallback(async () => {
    if (!profile) return;
    try {
      await onSaveProfile({
        system_prompt_parse: parsePrompt || null,
        system_prompt_chat: chatPrompt || null,
      });
      setStatus('Saved!');
      setTimeout(() => setStatus(''), 2000);
    } catch (err) {
      setStatus('Error: ' + (err as Error).message);
    }
  }, [profile, parsePrompt, chatPrompt, onSaveProfile]);

  if (loading) return null;

  return (
    <div>
      <div className="mb-6">
        <h2 className="font-display text-xl font-semibold mb-1">System Prompts</h2>
        <p className="text-muted-foreground">
          Customize the system prompts used for LLM calls. Leave empty to use the built-in defaults.
        </p>
      </div>

      {/* Parse Prompt */}
      <div className="border-b border-border pb-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <Label htmlFor="parse-prompt">Parse Prompt</Label>
          {parsePrompt && (
            <Button variant="ghost" size="sm" onClick={() => setParsePrompt('')}>
              Reset
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-2">Used when cleaning up pasted song input.</p>
        <Textarea
          id="parse-prompt"
          value={parsePrompt}
          onChange={e => setParsePrompt(e.target.value)}
          placeholder={defaults?.parse ?? ''}
          rows={6}
          className="font-mono text-code"
        />
      </div>

      {/* Chat Prompt */}
      <div className="pb-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <Label htmlFor="chat-prompt">Chat Prompt</Label>
          {chatPrompt && (
            <Button variant="ghost" size="sm" onClick={() => setChatPrompt('')}>
              Reset
            </Button>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-2">Used for chat-based song editing.</p>
        <Textarea
          id="chat-prompt"
          value={chatPrompt}
          onChange={e => setChatPrompt(e.target.value)}
          placeholder={defaults?.chat ?? ''}
          rows={6}
          className="font-mono text-code"
        />
      </div>

      <div className="flex items-center gap-4">
        <Button onClick={handleSave} disabled={!profile}>Save Changes</Button>
        {status && <span className="text-sm text-success">{status}</span>}
      </div>
    </div>
  );
}
