// PDF Export Utility
// Генерирует PDF с результатами теста

async function exportResultsToPDF(results, testName) {
  try {
    console.log('📄 Начинаем генерацию PDF...');
    
    // Динамически загружаем библиотеки
    const jsPDF = window.jspdf.jsPDF;
    const html2canvas = window.html2canvas;

    // Создаем HTML контент для PDF
    const htmlContent = generatePDFContent(results, testName);
    
    // Создаем временный контейнер
    const tempContainer = document.createElement('div');
    tempContainer.innerHTML = htmlContent;
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    tempContainer.style.width = '800px';
    tempContainer.style.backgroundColor = 'white';
    document.body.appendChild(tempContainer);

    // Конвертируем в canvas
    const canvas = await html2canvas(tempContainer, {
      scale: 2,
      backgroundColor: '#ffffff',
      logging: false,
      useCORS: true
    });

    // Создаем PDF
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4'
    });

    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    
    // Вычисляем масштаб
    const imgWidth = pageWidth - 20; // 10mm отступ с каждой стороны
    const imgHeight = (canvas.height * imgWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = 10; // 10mm сверху

    const imgData = canvas.toDataURL('image/png');

    // Добавляем контент на страницы
    while (heightLeft > 0) {
      if (position > 0) {
        pdf.addPage();
        position = 10;
      }
      
      const pageHeightAvailable = pageHeight - 20; // 10mm отступы
      const heightToPrint = Math.min(heightLeft, pageHeightAvailable);
      
      pdf.addImage(
        imgData,
        'PNG',
        10,
        position,
        imgWidth,
        (heightToPrint * imgWidth) / imgWidth
      );
      
      heightLeft -= heightToPrint;
      position = 0;
    }

    // Скачиваем PDF
    const fileName = `Результаты_${testName}_${new Date().toLocaleDateString('ru-RU')}.pdf`;
    pdf.save(fileName);
    
    console.log('✅ PDF успешно сгенерирован и скачан');

    // Удаляем временный контейнер
    document.body.removeChild(tempContainer);
    
    return true;
  } catch (error) {
    console.error('❌ Ошибка при генерации PDF:', error);
    alert('Ошибка при экспорте PDF: ' + error.message);
    return false;
  }
}

function generatePDFContent(results, testName) {
  const percent = Math.round(results.percent);
  const statusText = results.passed ? '✓ ПРОЙДЕН' : '✗ НЕ ПРОЙДЕН';
  const statusColor = results.passed ? '#10b981' : '#ef4444';
  const statusBg = results.passed ? '#f0fdf4' : '#fef2f2';

  // Генерируем HTML для PDF с встроенными стилями
  let html = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; padding: 40px; background: white; color: #1f2937;">
      
      <!-- Заголовок -->
      <div style="text-align: center; margin-bottom: 40px; border-bottom: 3px solid #e5e7eb; padding-bottom: 30px;">
        <h1 style="margin: 0; color: #0f172a; font-size: 32px; font-weight: 700;">Результаты теста</h1>
        <p style="margin: 12px 0 0 0; color: #64748b; font-size: 16px; font-weight: 500;">${escapeHtml(testName)}</p>
        <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 13px;">${new Date().toLocaleString('ru-RU')}</p>
      </div>

      <!-- Основной результат -->
      <div style="text-align: center; margin-bottom: 40px; background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%); border-radius: 16px; padding: 40px; border: 2px solid #e2e8f0;">
        <div style="font-size: 64px; font-weight: 700; color: ${statusColor}; margin-bottom: 16px;">${percent}%</div>
        <div style="font-size: 24px; color: ${statusColor}; font-weight: 600; margin-bottom: 8px;">${statusText}</div>
        <div style="font-size: 14px; color: #64748b;">${results.totalCorrect} из ${results.totalQuestions} вопросов</div>
      </div>

      <!-- Статистика в два столбца -->
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 40px;">
        <div style="background: #f0fdf4; border: 2px solid #86efac; border-radius: 12px; padding: 24px; text-align: center;">
          <div style="color: #4ade80; font-size: 28px; font-weight: 700; margin-bottom: 8px;">${results.totalCorrect}</div>
          <div style="color: #22863a; font-size: 14px; font-weight: 600;">Правильных ответов</div>
          <div style="color: #4ade80; font-size: 12px; margin-top: 4px;">${results.totalQuestions} всего</div>
        </div>
        
        <div style="background: #fef3c7; border: 2px solid #fcd34d; border-radius: 12px; padding: 24px; text-align: center;">
          <div style="color: #f59e0b; font-size: 28px; font-weight: 700; margin-bottom: 8px;">${results.earnedPoints.toFixed(1)}</div>
          <div style="color: #78350f; font-size: 14px; font-weight: 600;">Набрано баллов</div>
          <div style="color: #f59e0b; font-size: 12px; margin-top: 4px;">${results.possiblePoints.toFixed(1)} максимум</div>
        </div>
      </div>

      <!-- Результаты по темам -->
      <div style="margin-bottom: 40px;">
        <h2 style="margin: 0 0 24px 0; color: #0f172a; font-size: 20px; font-weight: 700; border-bottom: 3px solid #e2e8f0; padding-bottom: 16px;">
          📚 Результаты по темам
        </h2>
        
        ${results.topicResults.map((topic, idx) => {
          const topicPercent = Math.round(topic.percent);
          const topicStatus = topic.passed ? '✓' : '✗';
          const topicColor = topic.passed ? '#10b981' : '#ef4444';
          const bgColor = topic.passed ? '#f0fdf4' : '#fef2f2';
          const borderColor = topic.passed ? '#86efac' : '#fca5a5';
          
          return `
            <div style="background: ${bgColor}; border-left: 5px solid ${topicColor}; border-radius: 12px; padding: 20px; margin-bottom: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
                <div style="flex: 1;">
                  <div style="font-weight: 700; color: #0f172a; font-size: 15px; margin-bottom: 6px;">
                    <span style="color: ${topicColor}; font-size: 18px; margin-right: 10px;">${topicStatus}</span>
                    ${escapeHtml(topic.topicName)}
                  </div>
                  <div style="font-size: 13px; color: #64748b;">
                    ${topic.correct}/${topic.total} правильно • ${topic.earnedPoints.toFixed(1)}/${topic.possiblePoints.toFixed(1)} баллов
                  </div>
                </div>
                <div style="font-weight: 700; color: ${topicColor}; font-size: 18px; min-width: 50px; text-align: right;">${topicPercent}%</div>
              </div>
              
              <!-- Прогресс бар -->
              <div style="background: rgba(0,0,0,0.08); border-radius: 6px; height: 10px; margin: 12px 0; overflow: hidden;">
                <div style="background: ${topicColor}; height: 100%; width: ${topicPercent}%; border-radius: 6px;"></div>
              </div>

              ${topic.recommendedCourses && topic.recommendedCourses.length > 0 ? `
                <div style="margin-top: 14px; padding-top: 14px; border-top: 1px solid rgba(0,0,0,0.1);">
                  <div style="font-size: 12px; color: #64748b; margin-bottom: 8px; font-weight: 600;">📖 Рекомендуемые материалы:</div>
                  ${topic.recommendedCourses.map(course => `
                    <div style="font-size: 12px; color: #0066cc; margin-bottom: 6px; padding: 6px 0;">
                      • ${escapeHtml(course.title)}
                    </div>
                  `).join('')}
                </div>
              ` : ''}
            </div>
          `;
        }).join('')}
      </div>

      <!-- Рекомендации или поздравления -->
      <div style="border-radius: 12px; padding: 24px; margin-bottom: 20px; ${results.topicResults.some(t => !t.passed) ? `background: #fffbeb; border: 2px solid #f59e0b;` : `background: #f0fdf4; border: 2px solid #10b981;`}">
        ${results.topicResults.some(t => !t.passed) ? `
          <h3 style="margin: 0 0 12px 0; color: #92400e; font-size: 16px; font-weight: 700;">💡 Рекомендации для улучшения</h3>
          <ul style="margin: 0; padding-left: 20px; color: #78350f; font-size: 14px; line-height: 1.6;">
            ${results.topicResults.filter(t => !t.passed).map(topic => `
              <li style="margin-bottom: 10px;">
                <strong>${escapeHtml(topic.topicName)}</strong> – ${Math.round(topic.percent)}% верно. 
                ${topic.recommendedCourses && topic.recommendedCourses.length > 0 ? 'Рекомендуем пройти предложенные материалы.' : 'Рекомендуем повторить эту тему.'}
              </li>
            `).join('')}
          </ul>
        ` : `
          <div style="text-align: center;">
            <h3 style="margin: 0 0 8px 0; color: #15803d; font-size: 18px; font-weight: 700;">🎉 Отлично!</h3>
            <p style="margin: 0; color: #22863a; font-size: 14px;">Вы успешно прошли все темы теста.</p>
          </div>
        `}
      </div>

      <!-- Подвал -->
      <div style="margin-top: 40px; padding-top: 20px; border-top: 2px solid #e2e8f0; text-align: center; color: #94a3b8; font-size: 12px;">
        <p style="margin: 0;">✓ Документ автоматически сгенерирован системой тестирования</p>
        <p style="margin: 8px 0 0 0;">Дата: ${new Date().toLocaleString('ru-RU')}</p>
      </div>
    </div>
  `;

  return html;
}

function escapeHtml(str) {
  if (!str) return '';
  var div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}