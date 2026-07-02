import { describe, it, expect } from 'vitest';
import { ModelRouter, DEFAULT_ROUTING_TABLE } from '@/core/application/services/model-router';
import type { TaskKind } from '@/core/domain/model-route';

describe('ModelRouter', () => {
  it('routes each task kind to its configured model slug', () => {
    // Arrange
    const router = new ModelRouter();
    const cases: TaskKind[] = ['quick-answer', 'vision', 'reasoning', 'coding'];

    // Act + Assert
    for (const task of cases) {
      const route = router.route(task);
      expect(route.model).toBe(DEFAULT_ROUTING_TABLE[task]);
      expect(route.task).toBe(task);
    }
  });

  it('honors a custom routing table (dependency injection)', () => {
    // Arrange
    const router = new ModelRouter({
      'quick-answer': 'x/fast',
      vision: 'x/vision',
      reasoning: 'x/think',
      coding: 'x/code',
    });

    // Act
    const route = router.route('vision');

    // Assert
    expect(route.model).toBe('x/vision');
  });
});
