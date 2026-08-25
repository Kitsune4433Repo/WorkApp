import { describe, expect, it } from 'vitest';
import { buildZipEntryNames } from '../src/routes/documents';

describe('buildZipEntryNames', () => {
  it('appends the doc type as an extension', () => {
    const names = buildZipEntryNames([{ title: 'Site photo A', doc_type: 'jpg' }]);
    expect(names).toEqual(['Site photo A.jpg']);
  });

  it('numbers repeated titles instead of colliding (e.g. a "same location" group)', () => {
    const names = buildZipEntryNames([
      { title: 'Pole site photos', doc_type: 'jpg' },
      { title: 'Pole site photos', doc_type: 'png' },
      { title: 'Pole site photos', doc_type: 'jpg' },
    ]);
    expect(names).toEqual(['Pole site photos.jpg', 'Pole site photos (1).png', 'Pole site photos (2).jpg']);
  });

  it('sanitizes slashes in the title so it cannot escape into a nested zip path', () => {
    const names = buildZipEntryNames([{ title: '142 Elm St / Basement', doc_type: 'pdf' }]);
    expect(names).toEqual(['142 Elm St - Basement.pdf']);
  });

  it('omits the extension when doc_type is missing', () => {
    const names = buildZipEntryNames([{ title: 'Untyped file', doc_type: null }]);
    expect(names).toEqual(['Untyped file']);
  });
});
