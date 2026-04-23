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

#import "ApplicationError.h"


@implementation ApplicationError

- (instancetype) initWithLocalizedDescription:(NSString *)descr {
  return [self initWithCode: -1 localizedDescription: descr];
}

- (instancetype) initWithCode:(int)code localizedDescription:(NSString *)descr {
  return [self initWithCode: code
                   userInfo: @{NSLocalizedDescriptionKey: descr}];
}

- (instancetype) initWithCode:(int)code userInfo:(NSDictionary *)userInfo {
  return [super initWithDomain: @"Application" code: code userInfo: userInfo];
}

+ (instancetype) errorWithLocalizedDescription:(NSString *)descr {
  return [[[ApplicationError alloc] initWithLocalizedDescription: descr] autorelease];
}

+ (instancetype) errorWithCode:(int)code localizedDescription:(NSString *)descr {
  return [[[ApplicationError alloc] initWithCode: code localizedDescription: descr] autorelease];
}

+ (instancetype) errorWithCode:(int)code userInfo:(NSDictionary *)userInfo {
  return [[[ApplicationError alloc] initWithCode: code userInfo: userInfo] autorelease];
}

@end
