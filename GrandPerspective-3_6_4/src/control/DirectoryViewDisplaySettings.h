/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface DirectoryViewDisplaySettings : NSObject<NSCopying>

- (instancetype) initWithColorMappingKey:(NSString *)colorMappingKey
                         colorPaletteKey:(NSString *)colorPaletteKey
                            drawItemsKey:(NSString *)drawItemsKey
                                maskName:(NSString *)maskName
                             maskEnabled:(BOOL)maskEnabled
                        showEntireVolume:(BOOL)showEntireVolume NS_DESIGNATED_INITIALIZER;

+ (DirectoryViewDisplaySettings *)defaultSettings;

@property (nonatomic, copy) NSString *colorMappingKey;

@property (nonatomic, copy) NSString *colorPaletteKey;

@property (nonatomic, copy) NSString *drawItemsKey;

@property (nonatomic, copy, nullable) NSString *maskName;

@property (nonatomic) BOOL fileItemMaskEnabled;

@property (nonatomic) BOOL showEntireVolume;

@property (nonatomic) BOOL packagesAsFiles;

@end

NS_ASSUME_NONNULL_END
