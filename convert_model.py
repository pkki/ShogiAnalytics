"""
Convert shogi-camera Keras .h5 model to TensorFlow.js layers-model format.
Usage: python convert_model.py
"""
import h5py
import json
import struct
import numpy as np
import os

H5_PATH = r'C:/Users/xyz00/AppData/Local/Temp/shogi-camera/models/purple.h5'
OUT_DIR = r'C:/Users/xyz00/Desktop/ShogiAnalytics/public/shogi-model'

WEIGHT_ORDER = [
    ('conv2d_1/conv2d_1/kernel:0', 'conv2d_1/kernel', [3, 3, 1, 32]),
    ('conv2d_1/conv2d_1/bias:0',   'conv2d_1/bias',   [32]),
    ('conv2d_2/conv2d_2/kernel:0', 'conv2d_2/kernel', [3, 3, 32, 64]),
    ('conv2d_2/conv2d_2/bias:0',   'conv2d_2/bias',   [64]),
    ('conv2d_3/conv2d_3/kernel:0', 'conv2d_3/kernel', [3, 3, 64, 128]),
    ('conv2d_3/conv2d_3/bias:0',   'conv2d_3/bias',   [128]),
    ('dense_1/dense_1/kernel:0',   'dense_1/kernel',  [4608, 256]),
    ('dense_1/dense_1/bias:0',     'dense_1/bias',    [256]),
    ('dense_2/dense_2/kernel:0',   'dense_2/kernel',  [256, 256]),
    ('dense_2/dense_2/bias:0',     'dense_2/bias',    [256]),
    ('dense_3/dense_3/kernel:0',   'dense_3/kernel',  [256, 31]),
    ('dense_3/dense_3/bias:0',     'dense_3/bias',    [31]),
]

def convert():
    os.makedirs(OUT_DIR, exist_ok=True)

    # Extract weights and write binary shard
    bin_path = os.path.join(OUT_DIR, 'group1-shard1of1.bin')
    weight_specs = []
    offset = 0
    bin_data = bytearray()

    with h5py.File(H5_PATH, 'r') as f:
        mw = f['model_weights']
        for h5_key, tfjs_name, shape in WEIGHT_ORDER:
            # h5_key is relative to model_weights
            arr = np.array(mw[h5_key], dtype=np.float32)
            assert list(arr.shape) == shape, f'{h5_key}: expected {shape}, got {list(arr.shape)}'
            raw = arr.tobytes()
            bin_data += raw
            weight_specs.append({
                'name': tfjs_name,
                'shape': shape,
                'dtype': 'float32',
            })
            print(f'  {tfjs_name}: {shape} ({len(raw)} bytes)')
            offset += len(raw)

    with open(bin_path, 'wb') as f:
        f.write(bin_data)
    print(f'Wrote {len(bin_data)} bytes to {bin_path}')

    # Build TF.js model.json
    model_topology = {
        'class_name': 'Sequential',
        'config': {
            'name': 'sequential_1',
            'layers': [
                {
                    'class_name': 'Conv2D',
                    'config': {
                        'name': 'conv2d_1', 'trainable': True, 'dtype': 'float32',
                        'batch_input_shape': [None, 64, 64, 1],
                        'filters': 32, 'kernel_size': [3, 3], 'strides': [1, 1],
                        'padding': 'valid', 'data_format': 'channels_last',
                        'dilation_rate': [1, 1], 'activation': 'relu', 'use_bias': True,
                        'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1.0, 'mode': 'fan_avg', 'distribution': 'uniform', 'seed': None}},
                        'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                        'kernel_regularizer': None, 'bias_regularizer': None,
                        'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                    }
                },
                {
                    'class_name': 'MaxPooling2D',
                    'config': {
                        'name': 'max_pooling2d_1', 'trainable': True, 'dtype': 'float32',
                        'pool_size': [2, 2], 'strides': [2, 2], 'padding': 'valid', 'data_format': 'channels_last',
                    }
                },
                {
                    'class_name': 'Dropout',
                    'config': {'name': 'dropout_1', 'trainable': True, 'dtype': 'float32', 'rate': 0.2, 'noise_shape': None, 'seed': None}
                },
                {
                    'class_name': 'Conv2D',
                    'config': {
                        'name': 'conv2d_2', 'trainable': True, 'dtype': 'float32',
                        'filters': 64, 'kernel_size': [3, 3], 'strides': [1, 1],
                        'padding': 'valid', 'data_format': 'channels_last',
                        'dilation_rate': [1, 1], 'activation': 'relu', 'use_bias': True,
                        'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1.0, 'mode': 'fan_avg', 'distribution': 'uniform', 'seed': None}},
                        'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                        'kernel_regularizer': None, 'bias_regularizer': None,
                        'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                    }
                },
                {
                    'class_name': 'MaxPooling2D',
                    'config': {
                        'name': 'max_pooling2d_2', 'trainable': True, 'dtype': 'float32',
                        'pool_size': [2, 2], 'strides': [2, 2], 'padding': 'valid', 'data_format': 'channels_last',
                    }
                },
                {
                    'class_name': 'Dropout',
                    'config': {'name': 'dropout_2', 'trainable': True, 'dtype': 'float32', 'rate': 0.3, 'noise_shape': None, 'seed': None}
                },
                {
                    'class_name': 'Conv2D',
                    'config': {
                        'name': 'conv2d_3', 'trainable': True, 'dtype': 'float32',
                        'filters': 128, 'kernel_size': [3, 3], 'strides': [1, 1],
                        'padding': 'valid', 'data_format': 'channels_last',
                        'dilation_rate': [1, 1], 'activation': 'relu', 'use_bias': True,
                        'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1.0, 'mode': 'fan_avg', 'distribution': 'uniform', 'seed': None}},
                        'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                        'kernel_regularizer': None, 'bias_regularizer': None,
                        'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                    }
                },
                {
                    'class_name': 'MaxPooling2D',
                    'config': {
                        'name': 'max_pooling2d_3', 'trainable': True, 'dtype': 'float32',
                        'pool_size': [2, 2], 'strides': [2, 2], 'padding': 'valid', 'data_format': 'channels_last',
                    }
                },
                {
                    'class_name': 'Dropout',
                    'config': {'name': 'dropout_3', 'trainable': True, 'dtype': 'float32', 'rate': 0.4, 'noise_shape': None, 'seed': None}
                },
                {
                    'class_name': 'Flatten',
                    'config': {'name': 'flatten_1', 'trainable': True, 'dtype': 'float32'}
                },
                {
                    'class_name': 'Dense',
                    'config': {
                        'name': 'dense_1', 'trainable': True, 'dtype': 'float32',
                        'units': 256, 'activation': 'relu', 'use_bias': True,
                        'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1.0, 'mode': 'fan_avg', 'distribution': 'uniform', 'seed': None}},
                        'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                        'kernel_regularizer': None, 'bias_regularizer': None,
                        'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                    }
                },
                {
                    'class_name': 'Dropout',
                    'config': {'name': 'dropout_4', 'trainable': True, 'dtype': 'float32', 'rate': 0.5, 'noise_shape': None, 'seed': None}
                },
                {
                    'class_name': 'Dense',
                    'config': {
                        'name': 'dense_2', 'trainable': True, 'dtype': 'float32',
                        'units': 256, 'activation': 'relu', 'use_bias': True,
                        'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1.0, 'mode': 'fan_avg', 'distribution': 'uniform', 'seed': None}},
                        'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                        'kernel_regularizer': None, 'bias_regularizer': None,
                        'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                    }
                },
                {
                    'class_name': 'Dropout',
                    'config': {'name': 'dropout_5', 'trainable': True, 'dtype': 'float32', 'rate': 0.5, 'noise_shape': None, 'seed': None}
                },
                {
                    'class_name': 'Dense',
                    'config': {
                        'name': 'dense_3', 'trainable': True, 'dtype': 'float32',
                        'units': 31, 'activation': 'softmax', 'use_bias': True,
                        'kernel_initializer': {'class_name': 'VarianceScaling', 'config': {'scale': 1.0, 'mode': 'fan_avg', 'distribution': 'uniform', 'seed': None}},
                        'bias_initializer': {'class_name': 'Zeros', 'config': {}},
                        'kernel_regularizer': None, 'bias_regularizer': None,
                        'activity_regularizer': None, 'kernel_constraint': None, 'bias_constraint': None,
                    }
                },
            ]
        },
        'keras_version': '2.2.4',
        'backend': 'tensorflow',
    }

    model_json = {
        'format': 'layers-model',
        'generatedBy': 'keras v2.2.4',
        'convertedBy': 'manual h5py conversion',
        'modelTopology': model_topology,
        'weightsManifest': [
            {
                'paths': ['group1-shard1of1.bin'],
                'weights': weight_specs,
            }
        ],
    }

    json_path = os.path.join(OUT_DIR, 'model.json')
    with open(json_path, 'w') as f:
        json.dump(model_json, f, indent=2)
    print(f'Wrote model.json to {json_path}')
    print('Done!')

if __name__ == '__main__':
    convert()
