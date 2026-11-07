export const ASCII_GLYPHS = {
  V: ['10001', '10001', '10001', '10001', '10001', '01010', '00100'],
  B: ['11110', '10001', '10001', '11110', '10001', '10001', '11110'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
  S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110']
};

export const buildAsciiLogoPoints = () => {
  const text = 'VBLIS';
  const points = [];
  const letterWidth = 5;
  const spacing = 1.5;
  const totalWidth = text.length * letterWidth + (text.length - 1) * spacing;

  text.split('').forEach((letter, letterIndex) => {
    ASCII_GLYPHS[letter].forEach((row, rowIndex) => {
      row.split('').forEach((cell, columnIndex) => {
        if (cell !== '1') return;

        const centerX = letterIndex * (letterWidth + spacing) + columnIndex - totalWidth / 2;
        const centerY = rowIndex - 3;
        const samples = [-0.38, 0, 0.38];
        const depthSamples = [-1.35, -0.68, 0, 0.68, 1.35];

        samples.forEach(offsetX => {
          samples.forEach(offsetY => {
            points.push({ x: centerX + offsetX, y: centerY + offsetY, z: -1.35 });
            points.push({ x: centerX + offsetX, y: centerY + offsetY, z: 1.35 });
          });
        });

        depthSamples.forEach(z => {
          samples.forEach(offset => {
            points.push({ x: centerX - 0.38, y: centerY + offset, z });
            points.push({ x: centerX + 0.38, y: centerY + offset, z });
            points.push({ x: centerX + offset, y: centerY - 0.38, z });
            points.push({ x: centerX + offset, y: centerY + 0.38, z });
          });
        });
      });
    });
  });

  return points;
};

export const VBLIS_ASCII_POINTS = buildAsciiLogoPoints();
