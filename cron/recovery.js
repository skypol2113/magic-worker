const Queue = require('bull');
const config = require('../config/env');
const logger = require('../utils/logger');

class RecoveryManager {
  constructor() {
    this.redisConfig = {
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password
    };
    
    this.queues = {};
    this.initializeQueues();
  }

  initializeQueues() {
    const queueNames = ['wish matching', 'notification', 'background processing'];
    
    queueNames.forEach(name => {
      this.queues[name] = new Queue(name, { redis: this.redisConfig });
    });
  }

  async recoverStalledJobs() {
    logger.info('Запуск восстановления зависших задач...');
    
    for (const [queueName, queue] of Object.entries(this.queues)) {
      try {
        const stalledJobs = await queue.getJobs(['stalled']);
        logger.info(`Найдено ${stalledJobs.length} зависших задач в очереди ${queueName}`);
        
        for (const job of stalledJobs) {
          await this.handleStalledJob(job, queueName);
        }
      } catch (error) {
        logger.error(`Ошибка восстановления очереди ${queueName}:`, error);
      }
    }
  }

  async handleStalledJob(job, queueName) {
    try {
      // Проверяем, можно ли повторить задачу
      if (job.attemptsMade < job.opts.attempts) {
        logger.info(`Повторный запуск задачи ${job.id} из очереди ${queueName}`);
        await job.retry();
      } else {
        logger.warn(`Задача ${job.id} превысила лимит попыток, перемещаем в failed`);
        await job.moveToFailed(new Error('Max attempts exceeded'), true);
      }
    } catch (error) {
      logger.error(`Ошибка обработки зависшей задачи ${job.id}:`, error);
    }
  }

  async cleanupOldJobs() {
    logger.info('Очистка старых задач...');
    
    for (const [queueName, queue] of Object.entries(this.queues)) {
      try {
        // Удаляем завершенные задачи старше 7 дней
        const completed = await queue.getJobs(['completed']);
        const oldJobs = completed.filter(job => {
          const age = Date.now() - job.finishedOn;
          return age > 7 * 24 * 60 * 60 * 1000; // 7 дней
        });
        
        await Promise.all(oldJobs.map(job => job.remove()));
        logger.info(`Удалено ${oldJobs.length} старых задач из ${queueName}`);
      } catch (error) {
        logger.error(`Ошибка очистки очереди ${queueName}:`, error);
      }
    }
  }

  async healthCheck() {
    const health = {
      timestamp: new Date().toISOString(),
      region: process.env.REGION || 'global',
      status: 'healthy',
      queues: {}
    };

    for (const [queueName, queue] of Object.entries(this.queues)) {
      try {
        const counts = await queue.getJobCounts();
        const workers = await queue.getWorkers();
        
        health.queues[queueName] = {
          ...counts,
          workers: workers.length,
          isHealthy: counts.stalled < 10 // Если меньше 10 зависших задач
        };
      } catch (error) {
        health.queues[queueName] = { error: error.message, isHealthy: false };
      }
    }

    // Если есть проблемы в очередях, помечаем как unhealthy
    const unhealthyQueues = Object.values(health.queues).filter(q => !q.isHealthy);
    if (unhealthyQueues.length > 0) {
      health.status = 'degraded';
      health.message = `${unhealthyQueues.length} очередей имеют проблемы`;
    }

    return health;
  }
}

// Запуск как cron-задачи
if (require.main === module) {
  const recovery = new RecoveryManager();
  
  async function runRecoveryCycle() {
    logger.info('=== Запуск цикла восстановления ===');
    
    try {
      await recovery.recoverStalledJobs();
      await recovery.cleanupOldJobs();
      
      const health = await recovery.healthCheck();
      logger.info('Статус здоровья системы:', health);
      
    } catch (error) {
      logger.error('Критическая ошибка в цикле восстановления:', error);
    }
  }

  // Запускаем каждые 5 минут
  setInterval(runRecoveryCycle, 5 * 60 * 1000);
  
  // Первый запуск
  runRecoveryCycle();
}

module.exports = RecoveryManager;