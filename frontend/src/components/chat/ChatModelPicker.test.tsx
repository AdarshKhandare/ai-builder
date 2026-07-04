/**
 * Tests for `src/components/chat/ChatModelPicker.tsx`.
 *
 * The ChatModelPicker is the compact, in-line model selector that
 * lives next to the chat prompt. It mirrors the TopBar model picker
 * but with a tier-coded dot indicator and a smaller trigger.
 *
 * 2026-07-04 (Builder UX pass) — added as part of the Builder UX
 * polish. The chat picker is the primary way to switch models when
 * the user is in iteration mode (code is on screen).
 */
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ChatModelPicker } from './ChatModelPicker'
import type { ModelInfo } from '@/lib/api'

const MODELS: ModelInfo[] = [
  {
    id: 'opencode-go/minimax-m3',
    name: 'MiniMax M3',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'coder',
    input_price_per_mtok: 0.14,
    output_price_per_mtok: 0.28,
    context_window: 200_000,
    recommended: true,
    description: 'Cheap and fast.',
  },
  {
    id: 'opencode-go/qwen-3.7-max',
    name: 'Qwen 3.7 Max',
    provider: 'opencode-go',
    endpoint: 'openai',
    role: 'both',
    input_price_per_mtok: 1.2,
    output_price_per_mtok: 6.0,
    context_window: 128_000,
    recommended: false,
    description: 'Top-tier Qwen model.',
  },
]

describe('ChatModelPicker()', () => {
  it('test_renders_picker_trigger — picker trigger has aria-label', () => {
    render(
      <ChatModelPicker
        models={MODELS}
        selectedModel="opencode-go/minimax-m3"
        onModelChange={() => undefined}
        isStreaming={false}
      />,
    )

    expect(screen.getByLabelText('Select model')).toBeInTheDocument()
  })

  it('test_renders_current_model_name — trigger shows the current model name', () => {
    render(
      <ChatModelPicker
        models={MODELS}
        selectedModel="opencode-go/qwen-3.7-max"
        onModelChange={() => undefined}
        isStreaming={false}
      />,
    )

    // The selected model's display name is visible in the trigger.
    expect(screen.getByText('Qwen 3.7 Max')).toBeInTheDocument()
  })

  it('test_calls_onModelChange_when_picking — picking a new model fires the callback', () => {
    const onModelChange = vi.fn()
    render(
      <ChatModelPicker
        models={MODELS}
        selectedModel="opencode-go/minimax-m3"
        onModelChange={onModelChange}
        isStreaming={false}
      />,
    )

    // Open the dropdown by clicking the trigger.
    fireEvent.click(screen.getByLabelText('Select model'))

    // The Qwen model only appears as a dropdown item (not in the
    // trigger), so a single match is enough.
    fireEvent.click(screen.getByText('Qwen 3.7 Max'))

    expect(onModelChange).toHaveBeenCalledWith('opencode-go/qwen-3.7-max')
  })

  it('test_disabled_while_streaming — picker is non-interactive when isStreaming=true', () => {
    render(
      <ChatModelPicker
        models={MODELS}
        selectedModel="opencode-go/minimax-m3"
        onModelChange={() => undefined}
        isStreaming={true}
      />,
    )

    // The underlying Radix Select renders the trigger as a button
    // with `data-disabled` when the Select root is disabled.
    const trigger = screen.getByLabelText('Select model')
    expect(trigger).toHaveAttribute('data-disabled')
  })
})
