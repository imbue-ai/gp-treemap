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

#import <Cocoa/Cocoa.h>

@class NotifyingDictionary;
@class FileItemTest;

@interface FilterTestRepository : NSObject {
  // Contains the tests provided by the application.
  NSDictionary  *applicationProvidedTests;
}

@property (class, nonatomic, readonly) FilterTestRepository *defaultFilterTestRepository;

/* Returns the tests in a dictionary that can subsequently be modified.
 */
@property (nonatomic, readonly, strong) NotifyingDictionary *testsByNameAsNotifyingDictionary;

/* Returns dictionary as an NSDictionary, which is useful if the dictionary does not need to be
 * modified. Note, the dictionary can still be modified by casting it to NotifyingDictionary. This
 * is only a convenience method.
 */
@property (nonatomic, readonly, copy) NSDictionary *testsByName;

- (FileItemTest *)fileItemTestForName:(NSString *)name;

- (FileItemTest *)applicationProvidedTestForName:(NSString *)name;

- (void) storeUserCreatedTests;

@end
