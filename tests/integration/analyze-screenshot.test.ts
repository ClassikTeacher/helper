import { describe, it, expect } from 'vitest';
import { createContainer } from '@/bootstrap/container';
import { FakeLlmAdapter } from '@/infrastructure/mocks/fake-llm.adapter';
import { FakeScreenCaptureAdapter } from '@/infrastructure/mocks/fake-screen-capture.adapter';

describe('AnalyzeScreenshotUseCase (integration via DI container)', () => {
  it('streams the LLM response back to the caller', async () => {
    // Arrange — swap real adapters for deterministic fakes.
    const container = createContainer({
      llm: new FakeLlmAdapter('hello world from fake'),
      screenCapture: new FakeScreenCaptureAdapter(),
    });

    // Act
    let output = '';
    for await (const delta of container.useCases.analyzeScreenshot.execute({ prompt: 'what is on screen?' })) {
      output += delta;
    }

    // Assert
    expect(output.trim()).toBe('hello world from fake');
  });
});
