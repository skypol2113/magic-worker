import tensorflow as tf
import pandas as pd
import numpy as np
import json
import os
from sklearn.model_selection import train_test_split
from transformers import AutoTokenizer, TFAutoModel

class WishMatcherTrainer:
    def __init__(self):
        self.model = None
        self.tokenizer = None
        self.model_path = './ml/models'
        
    def load_data(self, data_path):
        """Загрузка данных для обучения"""
        try:
            with open(data_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return data
        except Exception as e:
            print(f"Error loading data: {e}")
            return []
    
    def preprocess_data(self, data):
        """Предобработка данных"""
        processed = []
        for item in data:
            if 'text' in item and 'matches' in item:
                processed.append({
                    'text': item['text'],
                    'matches': item['matches'],
                    'language': item.get('language', 'ru'),
                    'category': item.get('category', 'general')
                })
        return processed
    
    def create_siamese_model(self):
        """Создание сиамской нейросети для semantic matching"""
        # Энкодер на основе предобученной модели
        input_ids = tf.keras.layers.Input(shape=(128,), dtype=tf.int32, name='input_ids')
        attention_mask = tf.keras.layers.Input(shape=(128,), dtype=tf.int32, name='attention_mask')
        
        # Используем предобученную модель для эмбэддингов
        base_model = TFAutoModel.from_pretrained('cointegrated/rubert-tiny2')
        
        outputs = base_model(input_ids, attention_mask=attention_mask)
        embedding = outputs.last_hidden_state[:, 0, :]  # [CLS] token
        
        # Классификатор
        dense1 = tf.keras.layers.Dense(256, activation='relu')(embedding)
        dropout1 = tf.keras.layers.Dropout(0.3)(dense1)
        dense2 = tf.keras.layers.Dense(128, activation='relu')(dropout1)
        dropout2 = tf.keras.layers.Dropout(0.2)(dense2)
        output = tf.keras.layers.Dense(1, activation='sigmoid')(dropout2)
        
        model = tf.keras.Model(
            inputs=[input_ids, attention_mask],
            outputs=output
        )
        
        model.compile(
            optimizer=tf.keras.optimizers.Adam(learning_rate=2e-5),
            loss='binary_crossentropy',
            metrics=['accuracy']
        )
        
        return model
    
    def prepare_training_data(self, data):
        """Подготовка данных для обучения"""
        texts = []
        labels = []
        
        for item in data:
            texts.append(item['text'])
            # Преобразуем matches в бинарные метки
            labels.append(1 if len(item['matches']) > 0 else 0)
        
        return texts, labels
    
    def train(self, data_path, epochs=10, batch_size=16):
        """Основной метод обучения"""
        print("Загрузка данных...")
        raw_data = self.load_data(data_path)
        processed_data = self.preprocess_data(raw_data)
        
        if not processed_data:
            print("Нет данных для обучения")
            return
        
        print("Подготовка данных...")
        texts, labels = self.prepare_training_data(processed_data)
        
        # Разделение на train/validation
        X_train, X_val, y_train, y_val = train_test_split(
            texts, labels, test_size=0.2, random_state=42
        )
        
        print("Загрузка токенизатора...")
        self.tokenizer = AutoTokenizer.from_pretrained('cointegrated/rubert-tiny2')
        
        print("Токенизация данных...")
        train_encodings = self.tokenizer(
            X_train, 
            padding=True, 
            truncation=True, 
            max_length=128,
            return_tensors='tf'
        )
        
        val_encodings = self.tokenizer(
            X_val,
            padding=True,
            truncation=True,
            max_length=128,
            return_tensors='tf'
        )
        
        print("Создание модели...")
        self.model = self.create_siamese_model()
        
        print("Начало обучения...")
        history = self.model.fit(
            [train_encodings['input_ids'], train_encodings['attention_mask']],
            y_train,
            validation_data=(
                [val_encodings['input_ids'], val_encodings['attention_mask']],
                y_val
            ),
            epochs=epochs,
            batch_size=batch_size,
            verbose=1
        )
        
        # Сохранение модели
        if not os.path.exists(self.model_path):
            os.makedirs(self.model_path)
            
        self.model.save(f"{self.model_path}/wish_matcher_model.h5")
        self.tokenizer.save_pretrained(self.model_path)
        
        print("Обучение завершено!")
        return history

if __name__ == "__main__":
    trainer = WishMatcherTrainer()
    trainer.train('training_data.json', epochs=5)